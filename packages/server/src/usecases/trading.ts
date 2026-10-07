/**
 * Paper trading on live books. Quotes walk the market's real order book; an
 * order re-quotes on a fresh book, and money moves only as ledger lines,
 * written with the fills, the position change and an outbox event in one
 * transaction with the account row locked.
 *
 * Paper is an execution route like any other: going live swaps what happens
 * inside `execute` for a venue call, and nothing else changes.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { FeeSchedule } from "@imo/core/fees";
import { isTradable } from "@imo/core/lifecycle";
import type { Book, BookLevel } from "@imo/core/market";
import { quoteFromBook, type BookQuote, type QuoteMarket } from "@imo/core/quote";
import type { Deps } from "../composition";
import { VENUE_CATALOG } from "@imo/venues/catalog";
import { PAPER_ROUTE } from "../catalogs";
import type { Db, Queryable, Tx } from "../db/client";
import * as t from "../db/schema";
import { DESIGN_SOURCE } from "../demo/design-source";
import { cents, micros } from "../dto/money";
import { ApiError, conflict, invalid, notFound, unavailable } from "../errors";
import { appendEvent } from "../outbox";
import { activeRoute, type Viewer } from "./viewer";

/** The ticket's promise: a market order never fills more than 2¢ past the
    best price, and a move of more than 2¢ since the preview asks again. */
export const SLIPPAGE_MICROS = 20_000;
export const MIN_ORDER_MICROS = 1_000_000;

export type Side = "Buy" | "Sell";
export type OutcomeName = "Yes" | "No";

export interface OrderInput {
  market: string;
  side: Side;
  outcome: OutcomeName;
  type: "market" | "limit";
  /** Buys: dollars to spend, fees included. */
  amountCents?: number;
  /** Sells (and limit buys by size): whole shares. */
  shares?: number;
  limitCents?: number;
  /** The price the person confirmed; a move past slippage asks again. */
  expectedPriceCents?: number;
  clientOrderId: string;
  postId?: string;
}

type TradingDeps = Pick<Deps, "venues" | "clock" | "log">;
type MarketRow = typeof t.markets.$inferSelect;

const outcomeKey = (o: OutcomeName) => (o === "Yes" ? "yes" : "no");

async function loadMarket(db: Db | Tx, slug: string) {
  const [row] = await db.select().from(t.markets).where(eq(t.markets.slug, slug)).limit(1);
  if (!row) throw notFound("That market");
  return row;
}

async function feeSchedule(db: Db | Tx, market: MarketRow, routeId = PAPER_ROUTE): Promise<FeeSchedule[]> {
  const [route] = await db.select().from(t.executionRoutes).where(eq(t.executionRoutes.id, routeId));
  const venue = VENUE_CATALOG.find((v) => v.manifest.id === market.venueId)?.manifest;
  const appFee = route?.fee ?? { kind: "none" as const };
  return [
    { source: "venue", label: venue?.display.feeLabel ?? "Venue fee", model: market.venueFee },
    // No line at all when imo takes nothing (wallet trading).
    ...(appFee.kind === "none" ? [] : [{ source: "app" as const, label: "imo · 0.5%", model: appFee }]),
  ];
}

/** A fresh book from the market's own data source, refusing stale data. */
async function freshBook(deps: TradingDeps, market: MarketRow): Promise<Book> {
  if (!isTradable(market.status))
    throw new ApiError(409, "market_not_open", market.status === "paused"
      ? "Trading on this market is paused by the venue."
      : "This market isn't open for trading.");
  const source = deps.venues.sources.get(market.source);
  if (!source) throw unavailable("Live prices for this market aren't available right now.");
  const status = await source.status();
  if (!status.tradingActive)
    throw new ApiError(409, "venue_paused", "The venue has paused trading. Orders open again when it resumes.", {
      resumesAt: status.resumesAt,
    });
  const [book] = await source.getBooks([{ venueId: market.venueId, externalId: market.externalId }]);
  if (!book) throw unavailable("This market's order book didn't load. Try again in a moment.");
  // The demo dataset describes a fixed moment; live books must be current.
  const ttl = VENUE_CATALOG.find((v) => v.manifest.id === market.venueId)?.manifest.dataRights.quoteTtlSeconds ?? 5;
  if (market.source !== DESIGN_SOURCE && deps.clock.now().getTime() - Date.parse(book.at) > ttl * 2_000)
    throw unavailable("Prices for this market are delayed, so orders are paused until they're current.");
  return book;
}

function sideOf(book: Book, outcome: OutcomeName, side: Side): BookLevel[] {
  const o = book.outcomes.find((x) => x.outcome === outcomeKey(outcome));
  return (side === "Buy" ? o?.asks : o?.bids) ?? [];
}

function price(input: OrderInput, market: MarketRow, book: Book, schedule: FeeSchedule[]) {
  const scale = 10 ** market.quantityScale;
  // Paper tickets trade whole shares, whatever finer sizes a venue allows.
  const quoteMarket = { quantityScale: market.quantityScale, quantityStep: Math.max(market.quantityStep, scale), currencyScale: 6 };
  const levels = sideOf(book, input.outcome, input.side);
  const limit = input.type === "limit" && input.limitCents !== undefined ? micros(input.limitCents) : undefined;
  const common = { limitPrice: limit, maxSlippage: input.type === "market" ? SLIPPAGE_MICROS : undefined };
  if (input.side === "Buy" && input.amountCents !== undefined) {
    const budget = micros(input.amountCents);
    if (budget < MIN_ORDER_MICROS) throw invalid("Minimum order is $1.00.");
    return quoteFromBook(levels, { side: "buy", budget, ...common }, schedule, quoteMarket);
  }
  if (!input.shares || input.shares < 1 || !Number.isInteger(input.shares))
    throw invalid("Enter a whole number of shares.");
  const quantity = input.shares * scale;
  return quoteFromBook(
    levels,
    input.side === "Buy" ? { side: "buy", quantity, ...common } : { side: "sell", quantity, ...common },
    schedule,
    quoteMarket,
  );
}

/**
 * A limit order's preview: what crosses the book now, then the rest as if it
 * fills at the limit — the most the whole order can cost (fees as a taker).
 */
function previewLimit(input: OrderInput, market: MarketRow, book: Book, schedule: FeeSchedule[]) {
  const scale = 10 ** market.quantityScale;
  if (input.limitCents === undefined) throw invalid("Set a limit price between 1¢ and 99¢.");
  if (!input.shares || input.shares < 1 || !Number.isInteger(input.shares)) throw invalid("Enter a whole number of shares.");
  const limit = micros(input.limitCents);
  const wanted = input.shares * scale;
  const crosses = (price: number) => (input.side === "Buy" ? price <= limit : price >= limit);
  const levels: BookLevel[] = [];
  let taken = 0;
  for (const level of sideOf(book, input.outcome, input.side)) {
    if (!crosses(level.price) || taken >= wanted) break;
    const quantity = Math.min(level.quantity, wanted - taken);
    levels.push({ price: level.price, quantity });
    taken += quantity;
  }
  if (taken < wanted) {
    const last = levels.at(-1);
    if (last?.price === limit) last.quantity += wanted - taken;
    else levels.push({ price: limit, quantity: wanted - taken });
  }
  return quoteFromBook(
    levels,
    input.side === "Buy" ? { side: "buy", quantity: wanted } : { side: "sell", quantity: wanted },
    schedule,
    quoteMarketOf(market),
  );
}

/** The UI's Quote record, in cents. */
export function toQuoteDTO(q: BookQuote, market: MarketRow, input: OrderInput) {
  const scale = 10 ** market.quantityScale;
  const venueFee = q.fees.filter((f) => f.source === "venue").reduce((s, f) => s + f.amount, 0);
  const appFee = q.fees.filter((f) => f.source === "app").reduce((s, f) => s + f.amount, 0);
  const shares = q.quantity / scale;
  return {
    marketId: market.slug,
    side: input.side,
    outcome: input.outcome,
    shares,
    priceCents: q.averagePrice !== undefined ? cents(q.averagePrice) : 0,
    bestPriceCents: q.bestPrice !== undefined ? cents(q.bestPrice) : null,
    worstPriceCents: q.worstPrice !== undefined ? cents(q.worstPrice) : null,
    notionalCents: cents(q.notional),
    venueFeeCents: cents(venueFee),
    appFeeCents: cents(appFee),
    feeCents: cents(q.feeTotal),
    totalCents: cents(q.total),
    payoutCents: shares * 100,
    fees: q.fees.map((f) => ({ source: f.source, label: f.label, cents: cents(f.amount) })),
    complete: q.complete,
    limitedBy: q.limitedBy ?? null,
  };
}

/**
 * A limit buy entered as an amount (as the ticket does) is placed by shares:
 * the most whole shares that amount covers at the limit, fees included.
 */
function sizeLimitBuy(input: OrderInput, market: MarketRow, schedule: FeeSchedule[]): OrderInput {
  if (input.type !== "limit" || input.side !== "Buy" || input.shares !== undefined || input.amountCents === undefined)
    return input;
  if (input.limitCents === undefined) throw invalid("Set a limit price between 1¢ and 99¢.");
  // No more than the amount could buy at that price before fees.
  const ceiling = Math.ceil(micros(input.amountCents) / micros(input.limitCents)) * 10 ** market.quantityScale;
  const fit = quoteFromBook(
    [{ price: micros(input.limitCents), quantity: Math.max(ceiling, 1) }],
    { side: "buy", budget: micros(input.amountCents) },
    schedule,
    quoteMarketOf(market),
  );
  const shares = Math.floor(fit.quantity / 10 ** market.quantityScale);
  if (shares < 1) throw invalid("That amount doesn't cover one share at your limit, with fees.");
  return { ...input, shares, amountCents: undefined };
}

/** The preview on the live book. With wallet trading it's an estimate: the
    venue's own build (POST /orders) has the final numbers to sign. */
export async function previewOrder(deps: TradingDeps & Partial<Pick<Deps, "config">>, db: Db, raw: OrderInput) {
  const market = await loadMarket(db, raw.market);
  const book = await freshBook(deps, market);
  const schedule = await feeSchedule(db, market, deps.config ? activeRoute(deps.config) : PAPER_ROUTE);
  const input = sizeLimitBuy(raw, market, schedule);
  const q = input.type === "limit" ? previewLimit(input, market, book, schedule) : price(input, market, book, schedule);
  if (q.quantity === 0)
    throw invalid(
      input.side === "Buy"
        ? "The amount must cover at least one whole share and its fees."
        : "There are no bids to sell into right now.",
    );
  return toQuoteDTO(q, market, input);
}

async function lockAccount(tx: Tx, viewer: Viewer) {
  const [account] = await tx
    .select()
    .from(t.tradingAccounts)
    .where(eq(t.tradingAccounts.id, viewer.accountId))
    .for("update");
  if (!account) throw notFound("Your paper account");
  return account;
}

/** Shares held minus shares already committed to resting sells. */
async function sellable(tx: Tx, accountId: string, marketId: string, outcome: string) {
  const [position] = await tx
    .select()
    .from(t.positions)
    .where(and(eq(t.positions.accountId, accountId), eq(t.positions.marketId, marketId), eq(t.positions.outcome, outcome)));
  const [{ held }] = await tx
    .select({ held: sql<number>`coalesce(sum(${t.orders.reserved}), 0)::bigint` })
    .from(t.orders)
    .where(
      and(
        eq(t.orders.accountId, accountId),
        eq(t.orders.marketId, marketId),
        eq(t.orders.outcome, outcome),
        eq(t.orders.side, "sell"),
        inArray(t.orders.status, ["open", "partial"]),
      ),
    );
  return { position, available: (position?.quantity ?? 0) - Number(held) };
}

export interface Execution {
  price: number;
  quantity: number;
  notional: number;
  venueFee: number;
  appFee: number;
  fees: { source: string; label: string; amount: number }[];
  liquidity: "taker" | "maker";
  book?: { price: number; quantity: number }[];
  /** Wallet fills: the venue's fill id and the onchain signature. */
  venueFillId?: string;
  txSignature?: string;
}

/**
 * Apply fills to the ledger and the position, inside the caller's
 * transaction. Buys add shares at cost; sells release cost in proportion and
 * book realized P&L.
 */
export async function applyFills(
  tx: Tx,
  account: typeof t.tradingAccounts.$inferSelect,
  market: MarketRow,
  orderId: string,
  side: "buy" | "sell",
  outcome: string,
  executions: Execution[],
  now: Date,
) {
  let cashDelta = 0;
  for (const e of executions) {
    const fee = e.venueFee + e.appFee;
    await tx.insert(t.fills).values({
      orderId,
      accountId: account.id,
      marketId: market.id,
      outcome,
      side,
      price: e.price,
      quantity: e.quantity,
      notional: e.notional,
      fees: e.fees.map((f) => ({ source: f.source as never, label: f.label, amount: f.amount })),
      feeTotal: fee,
      liquidity: e.liquidity,
      book: e.book ?? null,
      venueFillId: e.venueFillId ?? null,
      txSignature: e.txSignature ?? null,
      createdAt: now,
    });
    const entries = [
      { amount: side === "buy" ? -e.notional : e.notional, kind: side as "buy" | "sell" },
      ...(e.venueFee ? [{ amount: -e.venueFee, kind: "venue_fee" as const }] : []),
      ...(e.appFee ? [{ amount: -e.appFee, kind: "app_fee" as const }] : []),
    ];
    await tx.insert(t.ledgerEntries).values(
      entries.map((entry) => ({
        accountId: account.id,
        amount: entry.amount,
        currency: account.currency,
        kind: entry.kind,
        refType: "order",
        refId: orderId,
        createdAt: now,
      })),
    );
    cashDelta += entries.reduce((s, entry) => s + entry.amount, 0);

    const [position] = await tx
      .select()
      .from(t.positions)
      .where(and(eq(t.positions.accountId, account.id), eq(t.positions.marketId, market.id), eq(t.positions.outcome, outcome)))
      .for("update");
    if (side === "buy") {
      if (position)
        await tx
          .update(t.positions)
          .set({ quantity: position.quantity + e.quantity, cost: position.cost + e.notional, fees: position.fees + fee })
          .where(and(eq(t.positions.accountId, account.id), eq(t.positions.marketId, market.id), eq(t.positions.outcome, outcome)));
      else
        await tx.insert(t.positions).values({
          accountId: account.id,
          marketId: market.id,
          outcome,
          quantity: e.quantity,
          cost: e.notional,
          fees: fee,
          openedAt: now,
        });
    } else {
      if (!position || position.quantity < e.quantity) throw invalid("You can't sell more shares than you hold.");
      // Cost and entry fees leave in proportion to the shares sold; the last
      // share takes the remainder, so nothing leaks to rounding.
      const last = position.quantity === e.quantity;
      const cost = last ? position.cost : Math.floor((position.cost * e.quantity) / position.quantity);
      const entryFees = last ? position.fees : Math.floor((position.fees * e.quantity) / position.quantity);
      await tx.insert(t.realizedPnl).values({
        accountId: account.id,
        marketId: market.id,
        outcome,
        kind: "sell",
        quantity: e.quantity,
        proceeds: e.notional,
        cost,
        entryFees,
        exitFees: fee,
        pnl: e.notional - fee - cost - entryFees,
        orderId,
        openedAt: position.openedAt,
        closedAt: now,
      });
      const where = and(eq(t.positions.accountId, account.id), eq(t.positions.marketId, market.id), eq(t.positions.outcome, outcome));
      if (last) await tx.delete(t.positions).where(where);
      else
        await tx
          .update(t.positions)
          .set({ quantity: position.quantity - e.quantity, cost: position.cost - cost, fees: position.fees - entryFees })
          .where(where);
    }
  }
  return cashDelta;
}

const REASONS: Record<NonNullable<BookQuote["limitedBy"]>, string> = {
  depth: "Filled what the book held; the rest wasn't available.",
  slippage: "Filled what was available within 2¢ of the best price.",
  limit: "Filled up to your limit price.",
};

/**
 * What the person sees. In the database `partial` means resting with some
 * filled; a market order's unfilled remainder is dropped (`expired`) and
 * shows as a partial fill, or as failed when nothing filled.
 */
export function statusView(status: (typeof t.ORDER_STATUSES)[number], filled: number) {
  switch (status) {
    case "open":
    case "pending":
      return "pending" as const;
    case "expired":
      return filled > 0 ? ("partial" as const) : ("failed" as const);
    case "rejected":
      return "failed" as const;
    default:
      return status;
  }
}

/** The UI's Order record. */
export async function orderDTO(db: Db | Tx, orderId: string) {
  const [row] = await db
    .select({ order: t.orders, slug: t.markets.slug, scale: t.markets.quantityScale })
    .from(t.orders)
    .innerJoin(t.markets, eq(t.markets.id, t.orders.marketId))
    .where(eq(t.orders.id, orderId));
  const { order, slug, scale } = row;
  const unit = 10 ** scale;
  // What the fills came to: cost with fees for buys, net proceeds for sells.
  const [sum] = await db
    .select({
      notional: sql<number>`coalesce(sum(${t.fills.notional}), 0)::bigint`,
      fees: sql<number>`coalesce(sum(${t.fills.feeTotal}), 0)::bigint`,
    })
    .from(t.fills)
    .where(eq(t.fills.orderId, order.id));
  const filledTotal = order.side === "buy" ? Number(sum.notional) + Number(sum.fees) : Number(sum.notional) - Number(sum.fees);
  const resting = order.status === "open" || order.status === "partial";
  return {
    id: order.id,
    clientOrderId: order.clientOrderId,
    quote: { ...(order.quote ?? {}), marketId: slug },
    status: statusView(order.status, order.filledQuantity),
    resting,
    remainingShares: resting && order.quantity !== null ? (order.quantity - order.filledQuantity) / unit : 0,
    type: order.type,
    reason: order.reason,
    at: order.createdAt.toISOString(),
    filledShares: order.filledQuantity / unit,
    filledTotalCents: cents(filledTotal),
    averagePriceCents: order.averagePrice !== null ? cents(order.averagePrice) : null,
    limitCents: order.limitPrice !== null ? cents(order.limitPrice) : null,
    postId: order.postId,
  };
}

export async function placeOrder(deps: TradingDeps, db: Db, viewer: Viewer, raw: OrderInput) {
  // Idempotent: the same clientOrderId returns the first result.
  const [existing] = await db
    .select({ id: t.orders.id })
    .from(t.orders)
    .where(and(eq(t.orders.userId, viewer.userId), eq(t.orders.clientOrderId, raw.clientOrderId)));
  if (existing) return orderDTO(db, existing.id);

  const market = await loadMarket(db, raw.market);
  const book = await freshBook(deps, market);
  const schedule = await feeSchedule(db, market);
  const input = sizeLimitBuy(raw, market, schedule);
  const q = price(input, market, book, schedule);
  // What the order is for: a limit's whole size — what crosses now and the
  // rest at its limit — even when nothing crosses yet. Fills come from q.
  const planned = input.type === "limit" && input.limitCents !== undefined ? previewLimit(input, market, book, schedule) : q;
  const scale = 10 ** market.quantityScale;

  if (input.expectedPriceCents !== undefined && q.averagePrice !== undefined) {
    const drift = Math.abs(q.averagePrice - micros(input.expectedPriceCents));
    if (drift > SLIPPAGE_MICROS)
      throw conflict("price_moved", "The price moved since your preview. Review the new quote.", {
        quote: toQuoteDTO(q, market, input),
      });
  }

  const now = deps.clock.now();
  const outcome = outcomeKey(input.outcome);
  const side = input.side === "Buy" ? "buy" : "sell";
  const wanted = input.shares !== undefined ? input.shares * scale : undefined;
  const limitPrice = input.type === "limit" && input.limitCents !== undefined ? micros(input.limitCents) : null;
  if (input.type === "limit" && (limitPrice === null || limitPrice <= 0 || limitPrice >= 1_000_000))
    throw invalid("Set a limit price between 1¢ and 99¢.");
  if (input.type === "limit" && wanted === undefined) throw invalid("Limit orders are placed by shares.");

  const orderId = await db.transaction(async (tx) => {
    const account = await lockAccount(tx, viewer);
    const available = account.cash - account.reserved;
    const asked = input.amountCents !== undefined ? micros(input.amountCents) : q.total;
    if (side === "buy" && Math.max(asked, q.total) > available)
      throw new ApiError(422, "insufficient_funds", `You have ${formatCents(available)} available.`, {
        availableCents: cents(available),
      });
    if (side === "sell") {
      const { available: shares } = await sellable(tx, account.id, market.id, outcome);
      if ((wanted ?? 0) > shares)
        throw new ApiError(422, "insufficient_shares", `You hold ${shares / scale} ${input.outcome} shares to sell.`, {
          availableShares: shares / scale,
        });
    }

    const remaining = wanted !== undefined ? wanted - q.quantity : 0;
    const rests = input.type === "limit" && remaining > 0;
    // A limit remainder rests; a market order's remainder is dropped.
    const status =
      rests ? (q.quantity > 0 ? "partial" : "open")
      : q.quantity === 0 ? "failed"
      : q.complete ? "filled"
      : "expired";
    // A resting buy holds its worst-case cost; a resting sell holds shares.
    let reserved = 0;
    if (rests && limitPrice !== null) {
      if (side === "buy") {
        const worst = quoteFromBook(
          [{ price: limitPrice, quantity: remaining }],
          { side: "buy", quantity: remaining },
          schedule,
          { quantityScale: market.quantityScale, quantityStep: Math.max(market.quantityStep, scale), currencyScale: 6 },
        );
        reserved = worst.total;
        if (q.total + reserved > available)
          throw invalid(`That order needs ${formatCents(q.total + reserved)} available.`);
      } else reserved = remaining;
    }

    const [order] = await tx
      .insert(t.orders)
      .values({
        accountId: account.id,
        userId: viewer.userId,
        routeId: PAPER_ROUTE,
        marketId: market.id,
        outcome,
        side,
        type: input.type,
        timeInForce: input.type === "limit" ? "gtc" : "ioc",
        limitPrice,
        quantity: wanted ?? null,
        budget: input.amountCents !== undefined ? micros(input.amountCents) : null,
        filledQuantity: q.quantity,
        averagePrice: q.averagePrice ?? null,
        reserved,
        status,
        reason:
          status === "failed" ? "No liquidity within 2¢ of the best price."
          : status === "expired" && q.limitedBy ? REASONS[q.limitedBy]
          : null,
        quote: toQuoteDTO(planned, market, input),
        postId: input.postId ?? null,
        clientOrderId: input.clientOrderId,
        createdAt: now,
      })
      .returning();

    const executions: Execution[] = q.fills.map((fill) => ({
      price: fill.price,
      quantity: fill.quantity,
      notional: fill.notional,
      venueFee: fill.fees.filter((f) => f.source === "venue").reduce((s, f) => s + f.amount, 0),
      appFee: fill.fees.filter((f) => f.source === "app").reduce((s, f) => s + f.amount, 0),
      fees: fill.fees,
      liquidity: "taker",
      book: sideOf(book, input.outcome, input.side).slice(0, 5),
    }));
    const cashDelta = await applyFills(tx, account, market, order.id, side, outcome, executions, now);
    await tx
      .update(t.tradingAccounts)
      .set({ cash: account.cash + cashDelta, reserved: account.reserved + (side === "buy" ? reserved : 0) })
      .where(eq(t.tradingAccounts.id, account.id));

    if (input.postId && q.quantity > 0) {
      const [post] = await tx.select({ outcome: t.posts.outcome }).from(t.posts).where(eq(t.posts.id, input.postId));
      if (post && side === "buy")
        await tx
          .update(t.posts)
          .set(post.outcome === outcome ? { backed: sql`${t.posts.backed} + 1` } : { faded: sql`${t.posts.faded} + 1` })
          .where(eq(t.posts.id, input.postId));
    }
    await appendEvent(tx, `order.${statusView(status, q.quantity)}`, `order:${order.id}`, {
      orderId: order.id,
      userId: viewer.userId,
      market: market.slug,
      side,
      outcome,
      filled: q.quantity / scale,
      averagePriceCents: q.averagePrice !== undefined ? cents(q.averagePrice) : null,
      totalCents: cents(q.total),
      limitCents: limitPrice !== null ? cents(limitPrice) : null,
    });
    return order.id;
  });
  return orderDTO(db, orderId);
}

const formatCents = (m: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(m / 1_000_000);

export async function cancelOrder(deps: TradingDeps, db: Db, viewer: Viewer, orderId: string) {
  await db.transaction(async (tx) => {
    const account = await lockAccount(tx, viewer);
    const [order] = await tx
      .select()
      .from(t.orders)
      .where(and(eq(t.orders.id, orderId), eq(t.orders.userId, viewer.userId)))
      .for("update");
    if (!order) throw notFound("That order");
    if (order.status !== "open" && order.status !== "partial")
      throw conflict("not_cancellable", "Only resting orders can be cancelled.");
    await tx
      .update(t.orders)
      .set({ status: "cancelled", reserved: 0, reason: "Cancelled by you" })
      .where(eq(t.orders.id, order.id));
    if (order.side === "buy")
      await tx
        .update(t.tradingAccounts)
        .set({ reserved: Math.max(0, account.reserved - order.reserved) })
        .where(eq(t.tradingAccounts.id, account.id));
    await appendEvent(tx, "order.cancelled", `order:${order.id}`, { orderId: order.id, userId: viewer.userId });
  });
  return orderDTO(db, orderId);
}

export async function listOrders(db: Db, viewer: Viewer, status?: "resting" | "all") {
  const rows = await db
    .select({ id: t.orders.id })
    .from(t.orders)
    .where(
      and(
        eq(t.orders.userId, viewer.userId),
        status === "resting" ? inArray(t.orders.status, ["open", "partial"]) : undefined,
      ),
    )
    .orderBy(desc(t.orders.createdAt))
    .limit(100);
  return { items: await Promise.all(rows.map((r) => orderDTO(db, r.id))) };
}

const quoteMarketOf = (market: MarketRow): QuoteMarket => ({
  quantityScale: market.quantityScale,
  quantityStep: Math.max(market.quantityStep, 10 ** market.quantityScale),
  currencyScale: 6,
});

/**
 * Resting limit orders against a fresh book. A resting order is a maker: when
 * the other side of the book reaches its limit, it fills at its own price, up
 * to the size the book shows there. Orders share that size in time priority,
 * so paper traders together never take more than the venue offers.
 */
export async function matchRestingOrders(
  deps: Pick<Deps, "clock">,
  db: Db,
  market: MarketRow,
  book: Book,
) {
  if (!isTradable(market.status)) return { fills: 0 };
  const resting = await db
    .select()
    .from(t.orders)
    .where(and(eq(t.orders.marketId, market.id), inArray(t.orders.status, ["open", "partial"])))
    .orderBy(asc(t.orders.createdAt));
  if (!resting.length) return { fills: 0 };
  const schedule = await feeSchedule(db, market);
  const quoteMarket = quoteMarketOf(market);
  const given = new Map<string, number>();
  let fills = 0;
  for (const order of resting) {
    if (order.limitPrice === null || order.quantity === null) continue;
    const limit = order.limitPrice;
    const levels = sideOf(book, order.outcome === "yes" ? "Yes" : "No", order.side === "buy" ? "Buy" : "Sell");
    const crossing = levels.filter((l) => (order.side === "buy" ? l.price <= limit : l.price >= limit));
    const key = `${order.outcome}:${order.side}`;
    const depth = crossing.reduce((sum, l) => sum + l.quantity, 0) - (given.get(key) ?? 0);
    let quantity = Math.min(order.quantity - order.filledQuantity, depth);
    quantity -= quantity % quoteMarket.quantityStep;
    if (quantity <= 0) continue;
    const filled = await fillResting(deps, db, market, order.id, quantity, schedule, quoteMarket);
    if (filled > 0) {
      given.set(key, (given.get(key) ?? 0) + filled);
      fills++;
    }
  }
  return { fills };
}

async function fillResting(
  deps: Pick<Deps, "clock">,
  db: Db,
  market: MarketRow,
  orderId: string,
  wanted: number,
  schedule: FeeSchedule[],
  quoteMarket: QuoteMarket,
): Promise<number> {
  const now = deps.clock.now();
  const scale = 10 ** market.quantityScale;
  return db.transaction(async (tx) => {
    // Account before order, the same lock order as placing and cancelling.
    const [owner] = await tx.select({ accountId: t.orders.accountId }).from(t.orders).where(eq(t.orders.id, orderId));
    if (!owner) return 0;
    const [account] = await tx
      .select()
      .from(t.tradingAccounts)
      .where(eq(t.tradingAccounts.id, owner.accountId))
      .for("update");
    const [order] = await tx.select().from(t.orders).where(eq(t.orders.id, orderId)).for("update");
    if (!account || !order || (order.status !== "open" && order.status !== "partial")) return 0;
    if (order.limitPrice === null || order.quantity === null) return 0;
    const limit = order.limitPrice;
    const side = order.side as "buy" | "sell";
    let quantity = Math.min(wanted, order.quantity - order.filledQuantity);
    const at = (q: number) =>
      quoteFromBook(
        [{ price: limit, quantity: q }],
        side === "buy"
          ? { side: "buy", quantity: q, liquidity: "maker" }
          : { side: "sell", quantity: q, liquidity: "maker" },
        schedule,
        quoteMarket,
      );
    let q = at(quantity);

    if (side === "buy") {
      // The order's own reservation plus free cash pays for it.
      const free = account.cash - account.reserved + order.reserved;
      if (q.total > free) {
        q = quoteFromBook(
          [{ price: limit, quantity }],
          { side: "buy", budget: Math.max(0, free), liquidity: "maker" },
          schedule,
          quoteMarket,
        );
        quantity = q.quantity;
      }
    } else {
      const [position] = await tx
        .select()
        .from(t.positions)
        .where(and(eq(t.positions.accountId, account.id), eq(t.positions.marketId, market.id), eq(t.positions.outcome, order.outcome)))
        .for("update");
      if ((position?.quantity ?? 0) < quantity) {
        quantity = position?.quantity ?? 0;
        if (quantity > 0) q = at(quantity);
      }
    }
    if (quantity <= 0) {
      await cancelResting(tx, [order], side === "sell" ? "You no longer hold these shares." : "Not enough cash to fill.", now);
      return 0;
    }

    const cashDelta = await applyFills(
      tx,
      account,
      market,
      order.id,
      side,
      order.outcome,
      q.fills.map((fill) => ({
        price: fill.price,
        quantity: fill.quantity,
        notional: fill.notional,
        venueFee: fill.fees.filter((f) => f.source === "venue").reduce((sum, f) => sum + f.amount, 0),
        appFee: fill.fees.filter((f) => f.source === "app").reduce((sum, f) => sum + f.amount, 0),
        fees: fill.fees,
        liquidity: "maker",
      })),
      now,
    );
    const filledQuantity = order.filledQuantity + q.quantity;
    const averagePrice = Math.round(((order.averagePrice ?? limit) * order.filledQuantity + limit * q.quantity) / filledQuantity);
    const left = order.quantity - filledQuantity;
    const status = left > 0 ? "partial" : "filled";
    let reserved = 0;
    if (side === "buy" && left > 0) {
      const worst = quoteFromBook([{ price: limit, quantity: left }], { side: "buy", quantity: left }, schedule, quoteMarket).total;
      // Never hold more than the account has once this fill is paid.
      const room = account.cash + cashDelta - (account.reserved - order.reserved);
      reserved = Math.max(0, Math.min(worst, room));
    } else if (side === "sell") reserved = left;

    await tx
      .update(t.orders)
      .set({ filledQuantity, averagePrice, status, reserved, reason: null })
      .where(eq(t.orders.id, order.id));
    await tx
      .update(t.tradingAccounts)
      .set({
        cash: account.cash + cashDelta,
        reserved: side === "buy" ? account.reserved - order.reserved + reserved : account.reserved,
      })
      .where(eq(t.tradingAccounts.id, account.id));
    await appendEvent(tx, `order.${statusView(status, filledQuantity)}`, `order:${order.id}`, {
      orderId: order.id,
      userId: order.userId,
      market: market.slug,
      side,
      outcome: order.outcome,
      filled: q.quantity / scale,
      totalFilled: filledQuantity / scale,
      quantity: order.quantity / scale,
      averagePriceCents: cents(limit),
      totalCents: cents(q.total),
      limitCents: cents(limit),
      maker: true,
    });
    return q.quantity;
  });
}

/** Cancel resting orders the person didn't cancel themselves (the market
    closed, a reset, a fill that could no longer be paid), releasing what
    they held. Inside the caller's transaction; the orders must be locked. */
export async function cancelResting(
  q: Queryable,
  orders: (typeof t.orders.$inferSelect)[],
  reason: string,
  now: Date,
) {
  for (const order of orders) {
    if (order.status !== "open" && order.status !== "partial") continue;
    await q.update(t.orders).set({ status: "cancelled", reserved: 0, reason }).where(eq(t.orders.id, order.id));
    if (order.side === "buy" && order.reserved > 0)
      await q
        .update(t.tradingAccounts)
        .set({ reserved: sql`greatest(0, ${t.tradingAccounts.reserved} - ${order.reserved})` })
        .where(eq(t.tradingAccounts.id, order.accountId));
    await appendEvent(q, "order.cancelled", `order:${order.id}`, {
      orderId: order.id,
      userId: order.userId,
      marketId: order.marketId,
      outcome: order.outcome,
      side: order.side,
      reason,
      system: true,
      at: now.toISOString(),
    });
  }
}

/** Every resting order in a market that can no longer trade. */
export async function cancelRestingInMarket(db: Db, marketId: string, reason: string, now: Date) {
  return db.transaction(async (tx) => {
    const resting = await tx
      .select()
      .from(t.orders)
      .where(and(eq(t.orders.marketId, marketId), inArray(t.orders.status, ["open", "partial"])))
      .for("update");
    await cancelResting(tx, resting, reason, now);
    return resting.length;
  });
}
