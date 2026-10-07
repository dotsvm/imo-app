/**
 * Real-money trading from the trader's own wallet. The venue builds an
 * unsigned transaction; the trader's wallet signs it on their device; we hand
 * the signed bytes back to the venue and mirror what fills into the same
 * orders, fills, positions and P&L tables paper trading uses, so posts, the
 * portfolio and the leaderboard read one shape. We never hold keys or funds.
 *
 *   build   → order `pending`, no signature yet (expires if never signed)
 *   submit  → signed bytes checked against the build, landed at the venue
 *   sync    → fills mirrored once each; final → filled · expired · failed
 */
import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { isTradable } from "@imo/core/lifecycle";
import type { Deps } from "../composition";
import { type ExecutionVenue, type OrderTicket, type UnsignedTransaction, VenueRejection } from "@imo/venues/sdk/execution";
import { WALLET_ROUTE } from "../catalogs";
import type { Db, Tx } from "../db/client";
import * as t from "../db/schema";
import { cents, micros } from "../dto/money";
import { ApiError, conflict, invalid, notFound, unavailable } from "../errors";
import { appendEvent } from "../outbox";
import { tradingMode } from "../composition/config";
import { claimPosition, getPortfolio, recordClaim } from "./portfolio";
import { applyFills, orderDTO, placeOrder, statusView, type OrderInput } from "./trading";
import type { Viewer } from "./viewer";

type WalletDeps = Pick<Deps, "venues" | "clock" | "log" | "chain" | "cache">;
type MarketRow = typeof t.markets.$inferSelect;

/** How long a built transaction waits for a signature: past this its
    blockhash has expired anyway (~60–90s), so nothing can land. */
export const SIGN_WINDOW_MS = 90_000;
/** Stop asking the venue about an order this long after it landed. */
const TRACK_FOR_MS = 2 * 60 * 60_000;

/** The trader's signing wallet: their embedded Solana wallet. */
export async function walletOf(db: Db, userId: string) {
  const rows = await db
    .select({ address: t.wallets.address, custody: t.wallets.custody, isPrimary: t.wallets.isPrimary })
    .from(t.wallets)
    .where(and(eq(t.wallets.userId, userId), eq(t.wallets.chain, "solana")));
  const wallet = rows.find((w) => w.isPrimary) ?? rows.find((w) => w.custody === "embedded") ?? rows[0];
  if (!wallet) throw new ApiError(409, "wallet_not_ready", "Your wallet is still being set up. Try again in a moment.");
  return wallet.address;
}

function venueFor(deps: WalletDeps, market: MarketRow) {
  const entry = deps.venues.execution.get(market.venueId);
  if (!entry) throw new ApiError(422, "not_wallet_tradable", "This market can't be traded with your wallet yet.");
  return entry;
}

/** Venue refusals as API errors the apps can show as-is. */
function asApiError(error: unknown): never {
  if (error instanceof VenueRejection) {
    const status = error.code === "insufficient_funds" || error.code === "min_order" ? 422 : error.code === "not_found" ? 404 : 409;
    throw new ApiError(status, error.code, error.message);
  }
  throw error;
}

/** Wallet info for the apps: where to deposit, and what's there. */
export async function walletInfo(deps: WalletDeps, db: Db, viewer: Viewer) {
  const address = await walletOf(db, viewer.userId);
  const collateral = [...deps.venues.execution.values()][0]?.module.collateral;
  let balance: { usdcCents: number; solLamports: number } | null = null;
  if (deps.chain && collateral) {
    try {
      const b = await deps.chain.balances(address, [collateral.mint]);
      balance = { usdcCents: cents(b.tokens[collateral.mint] ?? 0), solLamports: b.lamports };
    } catch (error) {
      deps.log.warn("wallet balance unavailable", { error: (error as Error).message });
    }
  }
  return {
    address,
    chain: "solana" as const,
    collateral: collateral ? { symbol: collateral.symbol, mint: collateral.mint } : null,
    /** Null when the chain couldn't be read just now (shown as unknown, not zero). */
    balance,
    minOrderCents: Math.min(...[...deps.venues.execution.values()].map((e) => cents(e.venue.minOrder))),
  };
}

function estimateDTO(ticket: OrderTicket, market: MarketRow, input: Pick<OrderInput, "side" | "outcome">) {
  const unit = 10 ** market.quantityScale;
  const e = ticket.estimate;
  return {
    marketId: market.slug,
    side: input.side,
    outcome: input.outcome,
    shares: e.quantity / unit,
    priceCents: cents(e.price),
    notionalCents: cents(e.notional),
    feeCents: cents(e.fees.total),
    venueFeeCents: cents(e.fees.venue),
    totalCents: cents(input.side === "Buy" ? e.notional + e.fees.total : e.notional - e.fees.total),
    payoutCents: cents(e.payoutIfWins),
    slippageBps: e.slippageBps ?? null,
  };
}

/** What the apps need to sign: the order, its estimate and the transaction. */
async function signable(db: Db | Tx, orderId: string) {
  const dto = await orderDTO(db, orderId);
  const [row] = await db.select({ quote: t.orders.quote, expiresAt: t.orders.expiresAt }).from(t.orders).where(eq(t.orders.id, orderId));
  const tx = (row?.quote as { tx?: UnsignedTransaction } | null)?.tx;
  return {
    order: dto,
    transaction: tx?.transaction ?? null,
    signers: tx?.signers ?? [],
    expiresAt: row?.expiresAt?.toISOString() ?? null,
  };
}

/**
 * Build an order for the trader's wallet to sign. Buys spend an amount of
 * USDC; sells name shares (all of them closes the position).
 */
export async function buildWalletOrder(deps: WalletDeps, db: Db, viewer: Viewer, input: OrderInput) {
  const [existing] = await db
    .select({ id: t.orders.id })
    .from(t.orders)
    .where(and(eq(t.orders.userId, viewer.userId), eq(t.orders.clientOrderId, input.clientOrderId)));
  if (existing) return signable(db, existing.id);

  if (input.type !== "market") throw invalid("Wallet orders fill at the market price; limit orders aren't available.");
  const [market] = await db.select().from(t.markets).where(eq(t.markets.slug, input.market)).limit(1);
  if (!market) throw notFound("That market");
  if (!isTradable(market.status)) throw new ApiError(409, "market_not_open", "This market isn't open for trading.");
  const { venue } = venueFor(deps, market);
  const owner = await walletOf(db, viewer.userId);
  const ref = { venueId: market.venueId, externalId: market.externalId };
  const outcome = input.outcome === "Yes" ? "yes" : "no";
  const unit = 10 ** market.quantityScale;

  let ticket: OrderTicket;
  try {
    if (input.side === "Buy") {
      if (input.amountCents === undefined) throw invalid("Say how much to spend.");
      if (micros(input.amountCents) < venue.minOrder)
        throw new ApiError(422, "min_order", `The minimum order is $${(venue.minOrder / 1_000_000).toFixed(0)}.`);
      ticket = await venue.buildOrder({ side: "buy", owner, ref, outcome, amount: micros(input.amountCents) });
    } else {
      if (input.shares === undefined || input.shares <= 0) throw invalid("Say how many shares to sell.");
      const held = (await venue.positions(owner)).find((p) => p.ref.externalId === market.externalId && p.outcome === outcome);
      if (!held || held.quantity <= 0) throw new ApiError(422, "insufficient_shares", `You don't hold ${input.outcome} shares here.`);
      const wanted = Math.round(input.shares * unit);
      if (wanted > held.quantity)
        throw new ApiError(422, "insufficient_shares", `You hold ${held.quantity / unit} ${input.outcome} shares to sell.`);
      ticket = await venue.buildOrder({
        side: "sell",
        owner,
        ref,
        outcome,
        positionId: held.id,
        quantity: wanted === held.quantity ? "all" : wanted,
      });
    }
  } catch (error) {
    asApiError(error);
  }

  const now = deps.clock.now();
  const estimate = estimateDTO(ticket, market, input);
  const [order] = await db
    .insert(t.orders)
    .values({
      accountId: viewer.accountId,
      userId: viewer.userId,
      routeId: WALLET_ROUTE,
      marketId: market.id,
      outcome,
      side: input.side === "Buy" ? "buy" : "sell",
      type: "market",
      timeInForce: "ioc",
      quantity: input.side === "Sell" ? Math.round((input.shares ?? 0) * unit) : null,
      budget: input.side === "Buy" ? micros(input.amountCents!) : null,
      status: "pending",
      quote: { ...estimate, tx: ticket.tx },
      postId: input.postId ?? null,
      clientOrderId: input.clientOrderId,
      venueOrderId: ticket.orderId,
      venuePositionId: ticket.positionId,
      expiresAt: new Date(now.getTime() + SIGN_WINDOW_MS),
      createdAt: now,
    })
    .returning({ id: t.orders.id });
  return signable(db, order.id);
}

/** Read a compact-u16 ("shortvec") length. */
function shortvec(bytes: Uint8Array, at: number): [number, number] {
  let value = 0;
  for (let i = 0; i < 3; i++) {
    const b = bytes[at + i]!;
    value |= (b & 0x7f) << (7 * i);
    if (!(b & 0x80)) return [value, at + i + 1];
  }
  throw invalid("That transaction isn't well formed.");
}

/** A transaction's message: everything after its signatures. */
export function messageOf(base64: string) {
  const bytes = Buffer.from(base64, "base64");
  const [count, offset] = shortvec(bytes, 0);
  const start = offset + count * 64;
  if (start > bytes.length) throw invalid("That transaction isn't well formed.");
  return bytes.subarray(start);
}

/**
 * Land the trader's signed transaction. It must be the very transaction we
 * built — same message, byte for byte — so this endpoint can't relay anything
 * else on our venue key.
 */
export async function submitWalletOrder(deps: WalletDeps, db: Db, viewer: Viewer, orderId: string, signed: string) {
  const [row] = await db
    .select({ order: t.orders, market: t.markets })
    .from(t.orders)
    .innerJoin(t.markets, eq(t.markets.id, t.orders.marketId))
    .where(and(eq(t.orders.id, orderId), eq(t.orders.userId, viewer.userId)));
  if (!row || row.order.routeId !== WALLET_ROUTE) throw notFound("That order");
  const { order, market } = row;
  if (order.txSignature) return (await syncWalletOrder(deps, db, order.id), signable(db, order.id));
  if (order.status !== "pending") throw conflict("not_pending", "This order is no longer waiting for a signature.");
  if (order.expiresAt && order.expiresAt < deps.clock.now()) {
    await expireUnsigned(db, order.id);
    throw conflict("expired", "That quote expired before it was signed. Nothing was charged — try again.");
  }
  const built = (order.quote as { tx?: UnsignedTransaction } | null)?.tx;
  if (!built) throw conflict("not_pending", "This order has nothing to sign.");
  if (!Buffer.from(messageOf(signed)).equals(Buffer.from(messageOf(built.transaction))))
    throw invalid("The signed transaction doesn't match this order.");

  const { venue } = venueFor(deps, market);
  let signature: string;
  try {
    ({ signature } = await venue.submit(signed, built));
  } catch (error) {
    if (error instanceof VenueRejection)
      await db.update(t.orders).set({ status: "rejected", reason: error.message }).where(eq(t.orders.id, order.id));
    asApiError(error);
  }
  await db
    .update(t.orders)
    .set({ txSignature: signature, submittedAt: deps.clock.now() })
    .where(eq(t.orders.id, order.id));
  try {
    await syncWalletOrder(deps, db, order.id);
  } catch (error) {
    // The worker keeps checking; landing succeeded either way.
    deps.log.warn("wallet order sync deferred", { orderId: order.id, error: (error as Error).message });
  }
  return signable(db, order.id);
}

async function expireUnsigned(db: Db, orderId: string) {
  await db
    .update(t.orders)
    .set({ status: "cancelled", reason: "Not signed in time. Nothing was charged." })
    .where(and(eq(t.orders.id, orderId), eq(t.orders.status, "pending"), isNull(t.orders.txSignature)));
}

/**
 * Ask the venue how a landed order is doing; mirror new fills (each exactly
 * once) and close the order out when it's final.
 */
export async function syncWalletOrder(deps: WalletDeps, db: Db, orderId: string) {
  const [row] = await db
    .select({ order: t.orders, market: t.markets })
    .from(t.orders)
    .innerJoin(t.markets, eq(t.markets.id, t.orders.marketId))
    .where(eq(t.orders.id, orderId));
  if (!row?.order.venueOrderId || !row.order.txSignature || row.order.status !== "pending") return { synced: false };
  const { order, market } = row;
  const { venue } = venueFor(deps, market);
  const owner = await walletOf(db, order.userId);
  const status = await venue.orderStatus(order.venueOrderId!, owner);
  const now = deps.clock.now();

  return db.transaction(async (tx) => {
    const [account] = await tx.select().from(t.tradingAccounts).where(eq(t.tradingAccounts.id, order.accountId)).for("update");
    const [locked] = await tx.select().from(t.orders).where(eq(t.orders.id, order.id)).for("update");
    if (!account || locked?.status !== "pending") return { synced: false };
    let filled = locked.filledQuantity;
    let spent = (locked.averagePrice ?? 0) * filled;
    let added = 0;
    for (const fill of status.fills) {
      const [seen] = await tx.select({ id: t.fills.id }).from(t.fills).where(eq(t.fills.venueFillId, fill.id));
      if (seen || fill.quantity <= 0) continue;
      await mirrorFill(tx, account, market, locked, fill, now);
      filled += fill.quantity;
      spent += fill.price * fill.quantity;
      added++;
    }
    const final = status.final;
    const state = !final ? "pending" : filled === 0 ? "failed" : status.state === "filled" ? "filled" : "expired";
    await tx
      .update(t.orders)
      .set({
        filledQuantity: filled,
        averagePrice: filled ? Math.round(spent / filled) : null,
        status: state,
        reason: state === "failed" ? (status.reason ?? "The venue couldn't fill this order. Your USDC was returned.") : state === "expired" ? "Filled what was available; the rest was returned to your wallet." : null,
      })
      .where(eq(t.orders.id, locked.id));
    if (final) {
      if (locked.postId && filled > 0 && locked.side === "buy") {
        const [post] = await tx.select({ outcome: t.posts.outcome }).from(t.posts).where(eq(t.posts.id, locked.postId));
        if (post)
          await tx
            .update(t.posts)
            .set(post.outcome === locked.outcome ? { backed: sql`${t.posts.backed} + 1` } : { faded: sql`${t.posts.faded} + 1` })
            .where(eq(t.posts.id, locked.postId));
      }
      const unit = 10 ** market.quantityScale;
      await appendEvent(tx, `order.${statusView(state, filled)}`, `order:${locked.id}`, {
        orderId: locked.id,
        userId: locked.userId,
        market: market.slug,
        side: locked.side,
        outcome: locked.outcome,
        filled: filled / unit,
        averagePriceCents: filled ? cents(Math.round(spent / filled)) : null,
        totalCents: cents(Math.round(spent / unit)),
        limitCents: null,
        signature: locked.txSignature,
      });
    }
    return { synced: true, fills: added, final, state };
  });
}

async function mirrorFill(
  tx: Tx,
  account: typeof t.tradingAccounts.$inferSelect,
  market: MarketRow,
  order: typeof t.orders.$inferSelect,
  fill: { id: string; price: number; quantity: number; notional: number; fee: number; signature?: string },
  now: Date,
) {
  // A sell can't take more than the mirror holds (a position opened elsewhere).
  let quantity = fill.quantity;
  if (order.side === "sell") {
    const [position] = await tx
      .select({ quantity: t.positions.quantity })
      .from(t.positions)
      .where(and(eq(t.positions.accountId, account.id), eq(t.positions.marketId, market.id), eq(t.positions.outcome, order.outcome)));
    quantity = Math.min(quantity, position?.quantity ?? 0);
    if (quantity <= 0) return;
  }
  const notional = quantity === fill.quantity ? fill.notional : Math.round((fill.notional * quantity) / fill.quantity);
  const cashDelta = await applyFills(tx, account, market, order.id, order.side, order.outcome, [
    {
      price: fill.price,
      quantity,
      notional,
      venueFee: fill.fee,
      appFee: 0,
      fees: fill.fee ? [{ source: "venue", label: "Venue fee", amount: fill.fee }] : [],
      liquidity: "taker",
      venueFillId: fill.id,
      txSignature: fill.signature,
    },
  ], now);
  // The money moved in the trader's wallet, not here: an offsetting line
  // keeps this account's ledger (and its cash) at zero.
  await walletTransfer(tx, account, "order", order.id, -cashDelta, market.shortTitle, now);
}

/** Money between the trader's wallet and a trade: in for buys, out for sells and payouts. */
export async function walletTransfer(
  tx: Tx,
  account: typeof t.tradingAccounts.$inferSelect,
  refType: string,
  refId: string,
  amount: number,
  title: string,
  now: Date,
) {
  if (!amount) return;
  await tx.insert(t.ledgerEntries).values({
    accountId: account.id,
    amount,
    currency: account.currency,
    kind: amount > 0 ? "deposit" : "adjustment",
    refType,
    refId,
    memo: amount > 0 ? `From your wallet · ${title}` : `To your wallet · ${title}`,
    createdAt: now,
  });
}

/**
 * The worker's pass over wallet orders: check the ones in flight, and expire
 * builds nobody signed.
 */
export async function syncInFlight(deps: WalletDeps, db: Db, now: Date) {
  const stale = await db
    .update(t.orders)
    .set({ status: "cancelled", reason: "Not signed in time. Nothing was charged." })
    .where(and(eq(t.orders.routeId, WALLET_ROUTE), eq(t.orders.status, "pending"), isNull(t.orders.txSignature), lt(t.orders.expiresAt, now)))
    .returning({ id: t.orders.id });
  const flying = await db
    .select({ id: t.orders.id })
    .from(t.orders)
    .where(
      and(
        eq(t.orders.routeId, WALLET_ROUTE),
        eq(t.orders.status, "pending"),
        isNotNull(t.orders.txSignature),
        sql`${t.orders.submittedAt} > ${new Date(now.getTime() - TRACK_FOR_MS).toISOString()}::timestamptz`,
      ),
    )
    .limit(50);
  let settled = 0;
  for (const { id } of flying) {
    try {
      const r = await syncWalletOrder(deps, db, id);
      if ("final" in r && r.final) settled++;
    } catch (error) {
      deps.log.warn("wallet order sync failed", { orderId: id, error: (error as Error).message });
    }
  }
  return { expired: stale.length, checked: flying.length, settled };
}

/**
 * A payout for a won position, as a transaction for the trader to sign.
 * Position ids are `<market slug>:(yes|no)`.
 */
export async function buildWalletClaim(deps: WalletDeps, db: Db, viewer: Viewer, id: string) {
  const [slug, outcome] = id.split(":");
  const [market] = await db.select().from(t.markets).where(eq(t.markets.slug, slug ?? "")).limit(1);
  if (!market) throw notFound("That position");
  const { venue } = venueFor(deps, market);
  const owner = await walletOf(db, viewer.userId);
  const held = (await positionsAt(venue, owner)).find((p) => p.ref.externalId === market.externalId && p.outcome === outcome);
  if (!held) throw notFound("That position");
  if (held.claimed) throw conflict("already_claimed", "That payout was already claimed.");
  if (!held.claimable) throw conflict("not_claimable", "This position has nothing to claim yet.");
  let ticket;
  try {
    ticket = await venue.buildClaim(held.id, owner);
  } catch (error) {
    asApiError(error);
  }
  // Kept server-side: only this transaction, signed, can be submitted.
  await deps.cache.set(claimKey(viewer.userId, id), ticket.tx, SIGN_WINDOW_MS / 1000);
  return { transaction: ticket.tx.transaction, signers: ticket.tx.signers, payoutCents: cents(ticket.payout), positionId: id };
}

const claimKey = (userId: string, id: string) => `wallet-claim:${userId}:${id}`;

/** Land a signed claim, then record the payout in the mirror. */
export async function submitWalletClaim(deps: WalletDeps, db: Db, viewer: Viewer, id: string, signed: string) {
  const built = await deps.cache.get<UnsignedTransaction>(claimKey(viewer.userId, id));
  if (!built) throw conflict("expired", "That claim expired before it was signed. Nothing happened — try again.");
  if (!Buffer.from(messageOf(signed)).equals(Buffer.from(messageOf(built.transaction))))
    throw invalid("The signed transaction doesn't match this claim.");
  const [slug, outcome] = id.split(":");
  const [market] = await db.select().from(t.markets).where(eq(t.markets.slug, slug ?? "")).limit(1);
  if (!market) throw notFound("That position");
  const { venue } = venueFor(deps, market);
  void outcome;
  let signature: string;
  try {
    ({ signature } = await venue.submit(signed, built));
  } catch (error) {
    asApiError(error);
  }
  await deps.cache.delete(claimKey(viewer.userId, id));
  const receipt = await recordClaim(db, viewer, id, deps.clock.now(), { onchain: true });
  return { ...receipt, signature };
}

async function positionsAt(venue: ExecutionVenue, owner: string) {
  try {
    return await venue.positions(owner);
  } catch (error) {
    if (error instanceof VenueRejection) asApiError(error);
    throw unavailable("Your positions didn't load from the venue. Try again in a moment.");
  }
}

// ---------------------------------------------------------------- dispatch
// The API's order, claim and portfolio endpoints serve both routes; these
// pick by the configured trading mode.

type RouteDeps = WalletDeps & Pick<Deps, "config">;

/** Paper fills at once; a wallet order comes back built, to be signed. */
export function placeOrBuild(deps: RouteDeps, db: Db, viewer: Viewer, input: OrderInput) {
  return tradingMode(deps.config) === "wallet" ? buildWalletOrder(deps, db, viewer, input) : placeOrder(deps, db, viewer, input);
}

/** Paper pays out at once; a wallet claim comes back built, to be signed. */
export function claimOrBuild(deps: RouteDeps, db: Db, viewer: Viewer, id: string) {
  return tradingMode(deps.config) === "wallet"
    ? buildWalletClaim(deps, db, viewer, id)
    : claimPosition(db, viewer, id, deps.clock.now());
}

/** The portfolio, with cash from the wallet onchain when trading for real. */
export async function portfolioFor(deps: RouteDeps, db: Db, viewer: Viewer) {
  if (tradingMode(deps.config) !== "wallet") return getPortfolio(db, viewer, deps.clock.now());
  const wallet = await walletInfo(deps, db, viewer).catch(() => null);
  const cash = wallet?.balance ? micros(wallet.balance.usdcCents) : null;
  return getPortfolio(db, viewer, deps.clock.now(), { cash });
}

/** One order; a wallet order in flight is checked with the venue first. */
export async function getOrder(deps: WalletDeps, db: Db, viewer: Viewer, orderId: string) {
  const [own] = await db
    .select({ id: t.orders.id, status: t.orders.status, signature: t.orders.txSignature })
    .from(t.orders)
    .where(and(eq(t.orders.id, orderId), eq(t.orders.userId, viewer.userId)));
  if (!own) throw notFound("That order");
  if (own.status === "pending" && own.signature)
    await syncWalletOrder(deps, db, own.id).catch((error: Error) =>
      deps.log.warn("wallet order sync failed", { orderId: own.id, error: error.message }),
    );
  return orderDTO(db, own.id);
}
