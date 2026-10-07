import type { DemoState, Market, Outcome, Quote, Trader, Position } from "./types";
import { complement } from "@imo/core/market";
import { priceFor, usd } from "./money";
/** The best price to sell into: the live bid (No's bid is 100 − Yes's ask).
    With that side of the book empty, the venue's own price — never a
    made-up one; the order itself is priced against the real book. */
export const bestBid = (market: Market, outcome: Outcome) => {
  if (market.status !== "open") return priceFor(market, outcome);
  const live = outcome === "Yes" ? market.yesBid : market.yesAsk != null ? complement(market.yesAsk) : undefined;
  return live != null ? live : priceFor(market, outcome);
};
/** The best price to buy at: the live ask (No's ask is 100 − Yes's bid). */
export const bestAsk = (market: Market, outcome: Outcome) => {
  if (market.status !== "open") return priceFor(market, outcome);
  const live = outcome === "Yes" ? market.yesAsk : market.yesBid != null ? complement(market.yesBid) : undefined;
  return live != null ? live : priceFor(market, outcome);
};
export const accuracy = (stats: { correct: number; resolved: number }) =>
  stats.resolved ? Math.round((stats.correct / stats.resolved) * 100) : 0;
/** The beta ranks on 10 resolved predictions (the server's floor, too). */
export const MIN_SAMPLE = 10;
/** Where a trader stands on the 30-day P&L board, among those with enough
    resolved predictions to rank; null when they don't qualify. */
export function pnlRank(trader: Trader, traders: Trader[]) {
  const board = traders
    .filter((t) => t.stats["30D"].resolved >= MIN_SAMPLE)
    .toSorted((a, b) => b.stats["30D"].pnlCents - a.stats["30D"].pnlCents);
  const at = board.findIndex((t) => t.id === trader.id);
  return at < 0 ? null : at + 1;
}
export const isLowSample = (trader: Trader, period: keyof Trader["stats"]) =>
  trader.stats[period].resolved < MIN_SAMPLE;
export const averageEntry = (position: Position) =>
  position.shares ? position.costCents / position.shares : 0;
export const unreadCount = (state: DemoState) =>
  state.notifications.filter((n) => !state.readNotifications.includes(n.id))
    .length;
export const availableCash = (state: DemoState) =>
  state.cashCents -
  (state.reservedCents ??
    state.orders
      .filter((o) => o.status === "pending" && o.quote.side === "Buy")
      .reduce((s, o) => s + o.quote.totalCents, 0));
export const availableShares = (
  state: DemoState,
  marketId: string,
  outcome: Outcome,
) =>
  state.positions
    .filter((p) => p.marketId === marketId && p.outcome === outcome)
    .reduce((s, p) => s + p.shares, 0) -
  state.orders
    .filter(
      (o) =>
        o.status === "pending" &&
        o.quote.side === "Sell" &&
        o.quote.marketId === marketId &&
        o.quote.outcome === outcome,
    )
    .reduce((s, o) => s + o.quote.shares, 0);
/** Checks a quote against what you can spend or sell. The server prices
    every quote and re-checks at placement; this only explains a refusal
    before the round trip. */
/** `askedCents`: the amount typed for a buy. A quote can come back smaller
    than asked (the book runs out within the slippage cap), but the server
    holds the amount asked for to the balance — and so does the ticket. */
export function validateQuote(state: DemoState, quote: Quote, askedCents?: number) {
  const { shares, totalCents, side } = quote;
  if (!Number.isFinite(shares) || shares <= 0)
    throw new Error("This quote is invalid. Please create a new preview.");
  if (side === "Buy" && Math.max(totalCents, askedCents ?? 0) > availableCash(state)) {
    const held = state.cashCents - availableCash(state);
    throw new Error(
      `Insufficient balance. You have ${usd(availableCash(state))} available${
        held > 0 ? ` (${usd(held)} held in open orders)` : ""
      }.`,
    );
  }
  if (side === "Sell") {
    const free = availableShares(state, quote.marketId, quote.outcome);
    if (shares > free)
      throw new Error(
        free > 0
          ? `You hold ${free.toLocaleString("en-US")} ${quote.outcome} shares.`
          : `You don’t hold ${quote.outcome} shares in this market.`,
      );
  }
}
/** Account value is cash plus positions at what they'd sell for now — the
    executable bid — and resolved ones at their payout. */
export function portfolioTotals(state: DemoState, markets: Market[]) {
  // The server's valuation when it gave one; otherwise the bid, once the
  // market has loaded.
  const valueCents = state.positions.reduce((s, p) => {
    if (p.valueCents !== undefined) return s + p.valueCents;
    const market = markets.find((m) => m.id === p.marketId);
    return s + (market ? p.shares * bestBid(market, p.outcome) : 0);
  }, 0);
  const basisCents = state.positions.reduce(
    (s, p) => s + p.costCents + p.feeCents,
    0,
  );
  const realizedCents = state.closed.reduce(
    (s, p) => s + p.proceedsCents - p.exitFeeCents - p.costCents - p.feeCents,
    0,
  );
  return {
    valueCents,
    basisCents,
    totalCents: state.cashCents + valueCents,
    unrealizedCents: valueCents - basisCents,
    realizedCents,
    feesCents:
      state.positions.reduce((s, p) => s + p.feeCents, 0) +
      state.closed.reduce((s, p) => s + p.feeCents + p.exitFeeCents, 0),
  };
}
