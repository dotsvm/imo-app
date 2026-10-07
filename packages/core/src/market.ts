/**
 * The canonical market model: everything past a venue adapter speaks this.
 * Nothing here names a venue. Outcomes are rows, so binary markets are simply
 * markets with two outcomes, and categorical ones need no new shape.
 */
import type { FeeModel } from "./fees";
import type { MarketStatus } from "./lifecycle";

/** Registry ids are plain strings on purpose: venues are data, not a union. */
export type VenueId = string;
export type DataSourceId = string;
export type RouteId = string;

/** A venue's own identifier for something, and the source that reported it. */
export interface ExternalRef {
  venueId: VenueId;
  /** Ticker, condition id, token id — whatever the venue uses. */
  externalId: string;
}

export type MarketType = "binary" | "categorical" | "scalar";

export interface Outcome {
  /** Stable key within the market: "yes" and "no" for binary markets. */
  key: string;
  label: string;
  index: number;
  /** The venue's id for this outcome, when it has one (Polymarket token ids). */
  externalId?: string;
}

export interface CanonicalMarket {
  ref: ExternalRef;
  eventRef?: ExternalRef;
  type: MarketType;
  title: string;
  shortTitle?: string;
  description?: string;
  rules: string;
  resolutionSource?: string;
  /** Venue categories and tags, mapped onto ours through the category map. */
  categoryHints: string[];
  outcomes: Outcome[];
  status: MarketStatus;
  /** Collateral the market settles in: a registered currency code. */
  currency: string;
  /** Smallest price step, in minor units of `currency`. */
  tick: number;
  /** Tiered ticks (Kalshi's `price_ranges`): the step that applies in each
      price band. Absent when one tick applies everywhere. */
  priceRanges?: PriceRange[];
  /** Share units per whole share: 10^quantityScale. */
  quantityScale: number;
  /** Smallest tradable quantity, in share units. */
  quantityStep: number;
  venueFee: FeeModel;
  opensAt?: string;
  closesAt: string;
  expectedResolutionAt?: string;
  resolution?: Resolution;
  /** Money, in minor units of `currency` (Kalshi's contract counts are
      converted at $1 of notional each). */
  stats?: {
    volume?: number;
    /** Traded in the last 24 hours. */
    volume24h?: number;
    openInterest?: number;
    liquidity?: number;
  };
  /** Top of book and the 24-hour move as the listing reports them, in minor
      units of `currency` — enough to price every card without fetching every
      book. Books, when fetched, are fresher and win. */
  snapshot?: {
    yesBid?: number;
    yesAsk?: number;
    last?: number;
    change24h?: number;
  };
}

/**
 * The Yes price a card shows: the midpoint while the spread is tight (10% of
 * the payout or less), otherwise the last trade — the rule venues' own sites
 * use, so a wide, empty book doesn't read as a 50% chance.
 */
export function headlinePrice(
  top: { bid?: number | null; ask?: number | null; lastTrade?: number | null },
  one = 1_000_000,
): number | undefined {
  const { bid, ask, lastTrade } = top;
  if (bid != null && ask != null) {
    const mid = Math.round((bid + ask) / 2);
    return ask - bid <= one / 10 ? mid : (lastTrade ?? mid);
  }
  return lastTrade ?? bid ?? ask ?? undefined;
}

export interface PriceRange {
  start: number;
  end: number;
  step: number;
}

/** Whether a price sits on the market's tick grid (tiered or flat). */
export function onTickGrid(
  price: number,
  market: Pick<CanonicalMarket, "tick" | "priceRanges">,
): boolean {
  const range = market.priceRanges?.find(
    (r) => price >= r.start && price <= r.end,
  );
  const step = range?.step ?? market.tick;
  return (price - (range?.start ?? 0)) % step === 0;
}

export interface Resolution {
  /** The winning outcome's key, or "void" when the venue cancels the market. */
  outcome: string | "void";
  /** Final only when the venue says the result can no longer change. */
  final: boolean;
  resolvedAt?: string;
  disputeEndsAt?: string;
}

/** One side of a book: best price first. */
export interface BookLevel {
  /** Minor units per whole share. */
  price: number;
  /** Share units available at this price. */
  quantity: number;
}

/** A normalized book for one outcome. */
export interface OutcomeBook {
  outcome: string;
  bids: BookLevel[];
  asks: BookLevel[];
}

export interface Book {
  ref: ExternalRef;
  outcomes: OutcomeBook[];
  /** When the venue produced this book. */
  at: string;
  /** Sequence number for gap detection, when the venue provides one. */
  seq?: number;
}

export interface Trade {
  ref: ExternalRef;
  outcome: string;
  price: number;
  quantity: number;
  at: string;
  side?: "buy" | "sell";
}

export interface Candle {
  start: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export const isBinary = (market: Pick<CanonicalMarket, "type" | "outcomes">) =>
  market.type === "binary" && market.outcomes.length === 2;

/** The Yes and No outcomes of a binary market, for the Yes/No UI. */
export function yesNo(market: Pick<CanonicalMarket, "type" | "outcomes">) {
  if (!isBinary(market)) throw new TypeError("Not a binary market");
  const yes = market.outcomes.find((o) => o.key === "yes");
  const no = market.outcomes.find((o) => o.key === "no");
  if (!yes || !no) throw new TypeError("Binary outcomes must be yes and no");
  return { yes, no };
}

/**
 * A binary book in terms of the Yes outcome. Venues that publish bids only
 * (Kalshi) complement the other side: a No bid at p is a Yes ask at 1 − p.
 */
export function complementLevels(
  levels: readonly BookLevel[],
  one: number,
): BookLevel[] {
  return levels
    .map((level) => ({ price: one - level.price, quantity: level.quantity }))
    .sort((a, b) => a.price - b.price);
}

/** True when bids are strictly descending, asks strictly ascending, quantities
    positive and the best bid is below the best ask. */
export function isWellFormed(book: OutcomeBook): boolean {
  const positive = (levels: BookLevel[]) =>
    levels.every((l) => Number.isSafeInteger(l.quantity) && l.quantity > 0);
  const ordered = (levels: BookLevel[], dir: 1 | -1) =>
    levels.every(
      (l, i) => i === 0 || (l.price - levels[i - 1].price) * dir > 0,
    );
  const bid = book.bids[0]?.price;
  const ask = book.asks[0]?.price;
  return (
    positive(book.bids) &&
    positive(book.asks) &&
    ordered(book.bids, -1) &&
    ordered(book.asks, 1) &&
    (bid === undefined || ask === undefined || bid < ask)
  );
}

/** The other side of a binary price, in cents: 100 minus it, kept to the
    hundredth of a cent venues quote in — so 100 − 99.3 is 0.7, never
    0.7000000000000028. */
export const complement = (cents: number) => Math.round((100 - cents) * 100) / 100;
