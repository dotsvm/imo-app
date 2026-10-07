import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import * as t from "@imo/server/db/schema";
import { getServerDeps, ready } from "@imo/server/deps";
import { seedDesignMarkets } from "@imo/server/demo/seed-markets";
import { settleMarket } from "@imo/server/usecases/portfolio";
import { POST as quote } from "../../src/app/api/v1/quotes/route";
import { GET as listOrders, POST as place } from "../../src/app/api/v1/orders/route";
import { POST as cancel } from "../../src/app/api/v1/orders/[id]/cancel/route";
import { GET as portfolio } from "../../src/app/api/v1/portfolio/route";
import { GET as activity } from "../../src/app/api/v1/portfolio/activity/route";
import { POST as claim } from "../../src/app/api/v1/positions/[id]/claim/route";
import { POST as reset } from "../../src/app/api/v1/account/reset/route";
import { resetDatabase } from "./helpers";
import { call, signIn } from "./http";

const deps = () => getServerDeps();
let auth = "";
let n = 0;
const cid = () => `test-order-${Date.now().toString(36)}-${n++}`;

type Portfolio = {
  account: { cashCents: number; availableCents: number; reservedCents: number; season: number };
  positions: { id: string; shares: number; costCents: number; feeCents: number }[];
  closed: { pnlCents: number; shares: number; kind: string }[];
  claims: { positionId: string; payoutCents: number }[];
};
const snapshot = async () => (await call<Portfolio>(portfolio, "/api/v1/portfolio", { auth })).body;

async function ledgerBalanced() {
  const { db } = deps();
  const rows = await db.execute<{ ok: boolean }>(sql`
    select bool_and(a.cash = coalesce(l.total, 0)) as ok
    from trading_accounts a
    left join (select account_id, sum(amount) as total from ledger_entries group by account_id) l
      on l.account_id = a.id`);
  assert.equal(rows[0].ok, true, "every account's cash equals its ledger");
}

before(async () => {
  await resetDatabase(deps().db);
  await ready();
  await seedDesignMarkets(deps().db, deps().log);
  auth = await signIn("trader-one", "Trader One");
});
after(async () => deps().database?.close());

test("a $100 Yes preview matches the design ticket exactly", async () => {
  const { status, body } = await call(quote, "/api/v1/quotes", {
    body: { market: "fed-dec", side: "Buy", outcome: "Yes", amountCents: 10_000 },
  });
  assert.equal(status, 200);
  assert.deepEqual(
    [body.shares, body.priceCents, body.notionalCents, body.venueFeeCents, body.appFeeCents, body.totalCents],
    [153, 63, 9639, 250, 48, 9937],
  );
});

test("a limit buy entered as an amount sizes to the design's 378 shares at 42¢", async () => {
  const { status, body } = await call(quote, "/api/v1/quotes", {
    body: { market: "fed-dec", side: "Buy", outcome: "Yes", type: "limit", limitCents: 42, amountCents: 16_600 },
  });
  assert.equal(status, 200);
  assert.deepEqual([body.shares, body.priceCents, body.venueFeeCents, body.appFeeCents, body.totalCents], [378, 42, 645, 79, 16_600]);
});

test("a market buy fills, charges the ledger, and is idempotent", async () => {
  const clientOrderId = cid();
  const order = { market: "fed-dec", side: "Buy", outcome: "Yes", amountCents: 10_000, expectedPriceCents: 63, clientOrderId };
  const first = await call(place, "/api/v1/orders", { auth, body: order });
  assert.equal(first.status, 201);
  assert.equal(first.body.status, "filled");
  assert.equal(first.body.filledShares, 153);
  const again = await call(place, "/api/v1/orders", { auth, body: order });
  assert.equal(again.body.id, first.body.id, "a retry returns the first order");
  const p = await snapshot();
  assert.equal(p.account.cashCents, 1_000_000 - 9937);
  assert.deepEqual([p.positions[0].shares, p.positions[0].costCents, p.positions[0].feeCents], [153, 9639, 298]);
  await ledgerBalanced();
});

test("a moved price asks again instead of filling", async () => {
  const { status, body } = await call<{ error: { code: string; details: { quote: { priceCents: number } } } }>(place, "/api/v1/orders", {
    auth,
    body: { market: "fed-dec", side: "Buy", outcome: "Yes", amountCents: 5_000, expectedPriceCents: 55, clientOrderId: cid() },
  });
  assert.equal(status, 409);
  assert.equal(body.error.code, "price_moved");
  assert.equal(body.error.details.quote.priceCents, 63);
});

test("selling part of a position books realized P&L and keeps the rest", async () => {
  const { body } = await call(place, "/api/v1/orders", {
    auth,
    body: { market: "fed-dec", side: "Sell", outcome: "Yes", shares: 53, clientOrderId: cid() },
  });
  assert.equal(body.status, "filled");
  const p = await snapshot();
  assert.equal(p.positions[0].shares, 100);
  assert.equal(p.closed[0].shares, 53);
  assert.ok(p.closed[0].pnlCents < 0, "bought at 63¢, sold at 61¢ with fees: a loss");
  await ledgerBalanced();
});

test("you can't spend what you don't have, or sell what you don't hold", async () => {
  const broke = await call(place, "/api/v1/orders", {
    auth,
    body: { market: "btc", side: "Buy", outcome: "Yes", amountCents: 50_000_000, clientOrderId: cid() },
  });
  assert.equal(broke.status, 422);
  assert.equal((broke.body as { error: { code: string } }).error.code, "insufficient_funds");
  const oversell = await call(place, "/api/v1/orders", {
    auth,
    body: { market: "fed-dec", side: "Sell", outcome: "Yes", shares: 1_000, clientOrderId: cid() },
  });
  assert.equal(oversell.status, 422);
  assert.equal((oversell.body as { error: { code: string } }).error.code, "insufficient_shares");
});

test("a market order fills what's within 2¢ and drops the rest", async () => {
  const { body } = await call(place, "/api/v1/orders", {
    auth,
    body: { market: "btc", side: "Buy", outcome: "Yes", amountCents: 900_000, clientOrderId: cid() },
  });
  assert.equal(body.status, "partial");
  assert.equal(body.resting, false, "a market order never rests");
  assert.ok((body.filledShares as number) > 0);
  await ledgerBalanced();
});

test("a resting limit reserves cash, and cancelling releases it", async () => {
  const before = await snapshot();
  const { body } = await call(place, "/api/v1/orders", {
    auth,
    body: { market: "cpi-oct", side: "Buy", outcome: "Yes", type: "limit", limitCents: 20, shares: 100, clientOrderId: cid() },
  });
  assert.equal(body.status, "pending");
  const held = await snapshot();
  assert.ok(held.account.reservedCents > 2000, "100 × 20¢ plus fees is held");
  assert.equal(held.account.availableCents, before.account.availableCents - held.account.reservedCents);
  const resting = await call<{ items: { id: string }[] }>(listOrders, "/api/v1/orders?status=resting", { auth });
  assert.equal(resting.body.items.length, 1);
  const cancelled = await call(cancel, `/api/v1/orders/${body.id}/cancel`, { auth, method: "POST", params: { id: body.id as string } });
  assert.equal(cancelled.body.status, "cancelled");
  assert.equal((await snapshot()).account.reservedCents, 0);
});

test("settlement pays winners exactly once, through a claim", async () => {
  const { db, clock } = deps();
  await db
    .update(t.markets)
    .set({ status: "resolved", resolution: { outcome: "yes", final: true } })
    .where(eq(t.markets.slug, "fed-dec"));
  const [market] = await db.select().from(t.markets).where(eq(t.markets.slug, "fed-dec"));
  const first = await settleMarket(db, market.id, clock.now());
  assert.equal(first.settled, true);
  assert.equal((await settleMarket(db, market.id, clock.now())).settled, false, "never twice");
  const p = await snapshot();
  assert.deepEqual(p.claims.map((c) => [c.positionId, c.payoutCents]), [["fed-dec:yes", 10_000]]);
  const cashBefore = p.account.cashCents;
  const paid = await call(claim, "/api/v1/positions/fed-dec:yes/claim", { auth, method: "POST", params: { id: "fed-dec:yes" } });
  assert.equal(paid.status, 200);
  assert.equal((await snapshot()).account.cashCents, cashBefore + 10_000);
  const twice = await call(claim, "/api/v1/positions/fed-dec:yes/claim", { auth, method: "POST", params: { id: "fed-dec:yes" } });
  assert.equal(twice.status, 409, "a payout is paid once");
  assert.equal((twice.body as { error: { code: string } }).error.code, "already_claimed");
  await ledgerBalanced();
  const feed = await call<{ items: { kind: string }[] }>(activity, "/api/v1/portfolio/activity", { auth });
  assert.ok(feed.body.items.some((i) => i.kind === "claim"));
});

test("a season reset restores the balance once per 30 days", async () => {
  const bad = await call(reset, "/api/v1/account/reset", { auth, body: { confirm: "reset" } });
  assert.equal(bad.status, 400, "the typed confirmation is required");
  const ok = await call(reset, "/api/v1/account/reset", { auth, body: { confirm: "RESET" } });
  assert.equal(ok.status, 200);
  const p = await snapshot();
  assert.deepEqual([p.account.cashCents, p.account.season, p.positions.length], [1_000_000, 2, 0]);
  const again = await call(reset, "/api/v1/account/reset", { auth, body: { confirm: "RESET" } });
  assert.equal(again.status, 422);
  await ledgerBalanced();
});
