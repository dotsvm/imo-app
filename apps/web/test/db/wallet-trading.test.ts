/**
 * Real-money trading end to end, against an in-memory venue: an order is
 * built, signed by the trader's wallet (here: bytes we flip), landed, filled
 * and mirrored; sells close it and claims pay out. The venue adapter itself is
 * tested on its own (tests/venues-jupiter-execution.test.ts).
 */
process.env.TRADING = "wallet";
// More orders per person than the API allows in a burst.
process.env.API_RATE_SCALE = "10";

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import * as t from "@imo/server/db/schema";
import { getServerDeps, ready } from "@imo/server/deps";
import { seedDesignMarkets } from "@imo/server/demo/seed-markets";
import { syncInFlight } from "@imo/server/usecases/wallet-trading";
import type {
  ClaimTicket,
  ExecutionVenue,
  OrderRequest,
  OrderTicket,
  VenueFill,
  WalletPosition,
} from "@imo/venues/sdk/execution";
import { POST as place } from "../../src/app/api/v1/orders/route";
import { POST as submit } from "../../src/app/api/v1/orders/[id]/submit/route";
import { GET as portfolio } from "../../src/app/api/v1/portfolio/route";
import { POST as claim } from "../../src/app/api/v1/positions/[id]/claim/route";
import { POST as submitClaim } from "../../src/app/api/v1/positions/[id]/claim/submit/route";
import { POST as withdraw } from "../../src/app/api/v1/wallet/withdraw/route";
import { POST as withdrawSubmit } from "../../src/app/api/v1/wallet/withdraw/submit/route";
import { resetDatabase } from "./helpers";
import { call, signIn } from "./http";

const deps = () => getServerDeps();
const PRICE = 600_000; // 60¢
let auth = "";
let n = 0;
const cid = () => `wallet-${Date.now().toString(36)}-${n++}`;

/** A transaction's wire bytes: one signature slot, then the message. */
const wire = (message: string, signature = 0) =>
  Buffer.concat([Buffer.from([1]), Buffer.alloc(64, signature), Buffer.from(message.padEnd(80, "."))]).toString("base64");
/** What the wallet hands back: the same message, now signed. */
const sign = (base64: string) => {
  const bytes = Buffer.from(base64, "base64");
  bytes.fill(7, 1, 65);
  return bytes.toString("base64");
};

/** Jupiter-shaped behaviour, in memory: every landed order fills at 60¢. */
class MemoryVenue implements ExecutionVenue {
  readonly minOrder = 5_000_000;
  /** Share units per contract: the market's 10^quantityScale. */
  unit = 1;
  readonly held = new Map<string, WalletPosition>();
  private readonly built = new Map<string, OrderRequest>();
  private readonly fills = new Map<string, VenueFill[]>();
  landed: string[] = [];

  async buildOrder(request: OrderRequest): Promise<OrderTicket> {
    const orderId = `order-${this.built.size + 1}`;
    this.built.set(orderId, request);
    const positionId = `pos-${request.ref.externalId}-${request.outcome}`;
    const quantity =
      request.side === "buy"
        ? Math.floor((request.amount * this.unit) / PRICE)
        : request.quantity === "all" ? this.held.get(positionId)?.quantity ?? 0 : request.quantity;
    return {
      tx: { transaction: wire(`build:${orderId}`), blockhash: "bh", lastValidBlockHeight: 1, signers: [request.owner] },
      orderId,
      positionId,
      estimate: {
        quantity,
        notional: Math.round((quantity * PRICE) / this.unit),
        price: PRICE,
        fees: { venue: 100_000, protocol: 0, total: 100_000 },
        payoutIfWins: (quantity * 1_000_000) / this.unit,
      },
    };
  }

  async submit(signed: string) {
    const [kind, rest] = Buffer.from(signed, "base64").subarray(65).toString().split(":");
    const target = rest!.replace(/\.+$/, "");
    this.landed.push(signed);
    if (kind === "claim") {
      this.held.delete(target);
      return { signature: `sig-claim-${target}` };
    }
    const orderId = target;
    const request = this.built.get(orderId)!;
    const positionId = `pos-${request.ref.externalId}-${request.outcome}`;
    const position = this.held.get(positionId);
    const quantity =
      request.side === "buy"
        ? Math.floor((request.amount * this.unit) / PRICE)
        : request.quantity === "all" ? position!.quantity : request.quantity;
    const notional = Math.round((quantity * PRICE) / this.unit);
    this.fills.set(orderId, [{ id: `fill-${orderId}`, at: new Date().toISOString(), price: PRICE, quantity, notional, fee: 100_000, signature: `sig-${orderId}` }]);
    const left = (position?.quantity ?? 0) + (request.side === "buy" ? quantity : -quantity);
    if (left > 0)
      this.held.set(positionId, {
        id: positionId,
        ref: request.ref,
        outcome: request.outcome,
        quantity: left,
        cost: (position?.cost ?? 0) + (request.side === "buy" ? notional : -notional),
        avgPrice: PRICE,
        fees: 0,
        realizedPnl: 0,
        payout: (left * 1_000_000) / this.unit,
        claimable: false,
        claimed: false,
        claimedAmount: 0,
        openOrders: 0,
      });
    else this.held.delete(positionId);
    return { signature: `sig-${orderId}` };
  }

  async orderStatus(orderId: string) {
    const fills = this.fills.get(orderId) ?? [];
    return { state: fills.length ? ("filled" as const) : ("submitted" as const), final: fills.length > 0, fills };
  }

  async positions() {
    return [...this.held.values()];
  }

  async buildClaim(positionId: string, owner: string): Promise<ClaimTicket> {
    const p = this.held.get(positionId)!;
    return { tx: { transaction: wire(`claim:${positionId}`), blockhash: "bh", lastValidBlockHeight: 1, signers: [owner] }, positionId, payout: p.payout };
  }
}

const venue = new MemoryVenue();
let market = { slug: "fed-dec", id: "" };

before(async () => {
  await resetDatabase(deps().db);
  await ready();
  await seedDesignMarkets(deps().db, deps().log);
  const [row] = await deps().db.select().from(t.markets).where(eq(t.markets.slug, market.slug));
  market = { slug: row!.slug, id: row!.id };
  venue.unit = 10 ** row!.quantityScale;
  (deps().venues.execution as Map<string, unknown>).set(row!.venueId, {
    module: { id: "memory", venues: [row!.venueId], collateral: { chain: "solana", mint: "USDC", decimals: 6, symbol: "USDC" } },
    venue,
  });
  auth = await signIn("wallet-trader", "Wallet Trader");
});
after(async () => deps().database?.close());

type Built = { order: { id: string; status: string; filledShares: number }; transaction: string | null; signers: string[] };
type Portfolio = {
  account: { kind: string; cashKnown: boolean; cashCents: number };
  positions: { id: string; shares: number }[];
  closed: { kind: string; pnlCents: number }[];
};

async function ledgerAtZero() {
  const rows = await deps().db.execute<{ ok: boolean }>(sql`
    select bool_and(a.cash = coalesce(l.total, 0)) as ok
    from trading_accounts a
    left join (select account_id, sum(amount) as total from ledger_entries group by account_id) l on l.account_id = a.id`);
  assert.equal(rows[0].ok, true, "every account's cash equals its ledger");
}

test("a buy is built, signed by the wallet, landed and mirrored", async () => {
  const built = await call<Built>(place, "/api/v1/orders", {
    auth,
    body: { market: market.slug, side: "Buy", outcome: "Yes", amountCents: 1_000, clientOrderId: cid() },
  });
  assert.equal(built.status, 201);
  assert.equal(built.body.order.status, "pending");
  assert.ok(built.body.transaction, "a transaction to sign");
  assert.match(built.body.signers[0]!, /.+/);

  const landed = await call<Built>(submit, `/api/v1/orders/${built.body.order.id}/submit`, {
    auth,
    params: { id: built.body.order.id },
    body: { signedTransaction: sign(built.body.transaction!) },
  });
  assert.equal(landed.status, 200, JSON.stringify(landed.body));
  assert.equal(landed.body.order.status, "filled");
  // $10 at 60¢: 16 whole shares on this market (venues with finer steps get 16.66).
  const shares = Math.floor((10 * venue.unit) / 0.6) / venue.unit;
  assert.equal(landed.body.order.filledShares, shares);

  const { body } = await call<Portfolio>(portfolio, "/api/v1/portfolio", { auth });
  assert.equal(body.account.kind, "wallet");
  assert.equal(body.account.cashKnown, false, "no chain reader in tests: unknown, not zero");
  assert.equal(body.positions.length, 1);
  assert.equal(body.positions[0]!.shares, shares);
  await ledgerAtZero();
});

test("only the transaction we built can be submitted, and only once", async () => {
  const built = await call<Built>(place, "/api/v1/orders", {
    auth,
    body: { market: market.slug, side: "Buy", outcome: "No", amountCents: 600, clientOrderId: cid() },
  });
  const forged = await call(submit, `/api/v1/orders/${built.body.order.id}/submit`, {
    auth,
    params: { id: built.body.order.id },
    body: { signedTransaction: wire("transfer:everything-somewhere-else", 9) },
  });
  assert.equal(forged.status, 422, "a different message is refused");
  const before = venue.landed.length;
  const signed = sign(built.body.transaction!);
  for (let i = 0; i < 2; i++) {
    const res = await call<Built>(submit, `/api/v1/orders/${built.body.order.id}/submit`, {
      auth,
      params: { id: built.body.order.id },
      body: { signedTransaction: signed },
    });
    assert.equal(res.status, 200);
  }
  assert.equal(venue.landed.length, before + 1, "a retry doesn't land twice");
});

test("under $5 never reaches the venue; an unsigned build expires", async () => {
  const small = await call<{ error: { code: string } }>(place, "/api/v1/orders", {
    auth,
    body: { market: market.slug, side: "Buy", outcome: "Yes", amountCents: 499, clientOrderId: cid() },
  });
  assert.equal(small.status, 422);
  assert.equal(small.body.error.code, "min_order");

  const built = await call<Built>(place, "/api/v1/orders", {
    auth,
    body: { market: market.slug, side: "Buy", outcome: "Yes", amountCents: 700, clientOrderId: cid() },
  });
  const later = new Date(Date.now() + 5 * 60_000);
  const result = await syncInFlight(deps(), deps().db, later);
  assert.ok(result.expired >= 1);
  const [row] = await deps().db.select().from(t.orders).where(eq(t.orders.id, built.body.order.id));
  assert.equal(row!.status, "cancelled");
  assert.match(row!.reason!, /Nothing was charged/);
});

test("selling everything closes the position with realized P&L", async () => {
  const sold = await call<Built>(place, "/api/v1/orders", {
    auth,
    body: { market: market.slug, side: "Sell", outcome: "Yes", shares: [...venue.held.values()].find((p) => p.outcome === "yes")!.quantity / venue.unit, clientOrderId: cid() },
  });
  assert.equal(sold.status, 201, JSON.stringify(sold.body));
  const landed = await call<Built>(submit, `/api/v1/orders/${sold.body.order.id}/submit`, {
    auth,
    params: { id: sold.body.order.id },
    body: { signedTransaction: sign(sold.body.transaction!) },
  });
  assert.equal(landed.body.order.status, "filled");
  const { body } = await call<Portfolio>(portfolio, "/api/v1/portfolio", { auth });
  assert.ok(!body.positions.some((p) => p.id === `${market.slug}:yes`), "the Yes position is closed");
  assert.ok(body.closed.some((c) => c.kind === "sell"));
  await ledgerAtZero();
});

test("a won position is claimed with a signed transaction", async () => {
  const built = await call<Built>(place, "/api/v1/orders", {
    auth,
    body: { market: market.slug, side: "Buy", outcome: "Yes", amountCents: 600, clientOrderId: cid() },
  });
  assert.equal(built.status, 201, JSON.stringify(built.body));
  await call(submit, `/api/v1/orders/${built.body.order.id}/submit`, {
    auth,
    params: { id: built.body.order.id },
    body: { signedTransaction: sign(built.body.transaction!) },
  });
  const id = `${market.slug}:yes`;
  const early = await call<{ error: { code: string } }>(claim, `/api/v1/positions/${id}/claim`, { auth, method: "POST", params: { id } });
  assert.equal(early.status, 409);
  assert.equal(early.body.error.code, "not_claimable");

  const position = [...venue.held.values()].find((p) => p.outcome === "yes")!;
  venue.held.set(position.id, { ...position, claimable: true });
  const ticket = await call<{ transaction: string; payoutCents: number }>(claim, `/api/v1/positions/${id}/claim`, {
    auth,
    method: "POST",
    params: { id },
  });
  assert.equal(ticket.status, 200, JSON.stringify(ticket.body));
  assert.equal(ticket.body.payoutCents, position.payout / 10_000);

  const paid = await call<{ payoutCents: number; signature: string }>(submitClaim, `/api/v1/positions/${id}/claim/submit`, {
    auth,
    params: { id },
    body: { signedTransaction: sign(ticket.body.transaction) },
  });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.ok(paid.body.signature);
  const again = await call<{ error: { code: string } }>(submitClaim, `/api/v1/positions/${id}/claim/submit`, {
    auth,
    params: { id },
    body: { signedTransaction: sign(ticket.body.transaction) },
  });
  assert.equal(again.status, 409, "the build is used up");
  const { body } = await call<Portfolio>(portfolio, "/api/v1/portfolio", { auth });
  assert.ok(body.closed.some((c) => c.kind === "settlement"));
  await ledgerAtZero();
});

test("a withdrawal is a USDC transfer only the trader signs, relayed as built", async () => {
  const { getTransactionDecoder, getCompiledTransactionMessageDecoder } = await import("@solana/kit");
  const OWNER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
  const TO = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  // The one trader this file signs in, given a real (valid) Solana address.
  const [{ id: userId }] = await deps().db.select({ id: t.users.id }).from(t.users).limit(1);
  await deps().db.update(t.wallets).set({ address: OWNER }).where(and(eq(t.wallets.userId, userId), eq(t.wallets.chain, "solana")));
  const sent: string[] = [];
  (deps() as { chain: unknown }).chain = {
    balances: async () => ({ lamports: 20_000_000, tokens: { USDC: 25_000_000 } }),
    latestBlockhash: async () => ({ blockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k", lastValidBlockHeight: 100 }),
    send: async (signed: string) => (sent.push(signed), "5igWithdrawal"),
    status: async () => ({ confirmed: true, error: null }),
  };
  // The in-memory venue's collateral mint ("USDC") isn't a real mint: use one.
  const entry = [...deps().venues.execution.values()][0]!;
  (entry.module as { collateral: { mint: string } }).collateral.mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  (deps() as { chain: { balances: unknown } }).chain.balances = async () => ({
    lamports: 20_000_000,
    tokens: { EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 25_000_000 },
  });

  const tooMuch = await call<{ error: { code: string } }>(withdraw, "/api/v1/wallet/withdraw", { auth, body: { to: TO, amountCents: 3_000 } });
  assert.equal(tooMuch.body.error.code, "insufficient_funds");
  const self = await call(withdraw, "/api/v1/wallet/withdraw", { auth, body: { to: OWNER, amountCents: 1_000 } });
  assert.equal(self.status, 422, "not to your own wallet");

  const built = await call<{ transaction: string; signers: string[]; amountCents: number }>(withdraw, "/api/v1/wallet/withdraw", {
    auth,
    body: { to: TO, amountCents: 1_000 },
  });
  assert.equal(built.status, 200, JSON.stringify(built.body));
  assert.deepEqual(built.body.signers, [OWNER]);
  const tx = getTransactionDecoder().decode(Buffer.from(built.body.transaction, "base64"));
  const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  assert.equal(message.staticAccounts[0], OWNER, "the trader pays the fee");
  assert.equal(message.header.numSignerAccounts, 1, "and is the only signer");
  assert.ok("instructions" in message, "a v0 message");
  assert.equal(message.instructions.length, 2, "open the recipient's account if needed, then transfer");

  const forged = await call(withdrawSubmit, "/api/v1/wallet/withdraw/submit", { auth, body: { signedTransaction: wire("transfer:elsewhere", 3) } });
  assert.equal(forged.status, 422);
  const done = await call<{ signature: string; status: string; amountCents: number }>(withdrawSubmit, "/api/v1/wallet/withdraw/submit", {
    auth,
    body: { signedTransaction: sign(built.body.transaction) },
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.deepEqual([done.body.signature, done.body.status, done.body.amountCents], ["5igWithdrawal", "confirmed", 1_000]);
  assert.equal(sent.length, 1);
});
