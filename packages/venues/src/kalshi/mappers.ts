/**
 * Kalshi → canonical. Pure functions, tested against recorded payloads.
 * Prices are 4-decimal dollar strings → micro-dollars; sizes are fixed-point
 * contract counts → hundredths of a contract.
 */
import type { FeeModel } from "@imo/core/fees";
import {
  complementLevels,
  type Book,
  type BookLevel,
  type CanonicalMarket,
  type Candle,
  type PriceRange,
  type Trade,
} from "@imo/core/market";
import { formatUnits, parseUnits, pow10, mulDiv } from "@imo/core/money";
import { mapStatus } from "../sdk/manifest";
import { kalshi } from "./manifest";
import type {
  CandlesResponse,
  KalshiEvent,
  KalshiMarket,
  KalshiSeries,
  OrderbookResponse,
  TradesResponse,
} from "./schemas";
import type { z } from "zod";

export const QUANTITY_SCALE = 2;
const ONE = pow10(6);

export const price = (dollars: string) => parseUnits(dollars, 6);
export const quantity = (fp: string) => parseUnits(fp, QUANTITY_SCALE, "floor");
/** Contracts × $1 notional, in micro-dollars. */
const contractsToMicros = (fp: string) => parseUnits(fp, 6, "floor");
/** A quoted price, or nothing: Kalshi reports an empty side as 0 or $1. */
const quoted = (dollars?: string) => {
  if (!dollars) return undefined;
  const p = price(dollars);
  return p > 0 && p < 1_000_000 ? p : undefined;
};

/** Combo (multivariate) and scalar markets aren't listed in the beta. */
export const listable = (market: KalshiMarket) =>
  market.market_type === "binary" &&
  !market.mve_collection_ticker &&
  !market.event_ticker.startsWith("KXMVE");

/** The series' fee: 0.07 × multiplier on takers, and a maker fee on series
    that charge one. */
export function feeModel(series?: z.infer<typeof KalshiSeries>): FeeModel {
  if (!series) return kalshi.fees.default;
  const scale = (base: string) =>
    formatUnits(
      mulDiv(
        parseUnits(base, 6),
        Math.round(series.fee_multiplier * 1_000_000),
        1_000_000,
        "half-up",
      ),
      6,
    );
  const taker: FeeModel = {
    kind: "quadratic",
    rate: scale("0.07"),
    appliesTo: "taker",
    rounding: { mode: "ceil", decimals: 6 },
  };
  if (series.fee_type === "quadratic_with_maker_fees")
    return {
      kind: "composite",
      parts: [taker, { ...taker, rate: scale("0.0175"), appliesTo: "maker" }],
    };
  if (series.fee_type === "quadratic") return taker;
  return kalshi.fees.default;
}

function ranges(market: KalshiMarket): PriceRange[] | undefined {
  return market.price_ranges?.map((r) => ({
    start: price(r.start),
    end: price(r.end),
    step: price(r.step),
  }));
}

export function toCanonicalMarket(
  market: KalshiMarket,
  event?: Pick<
    KalshiEvent,
    "title" | "category" | "series_ticker" | "mutually_exclusive" | "markets"
  >,
  series?: z.infer<typeof KalshiSeries>,
): CanonicalMarket {
  const tiers = ranges(market);
  const status = mapStatus(kalshi, market.status);
  const result =
    market.result === "yes" || market.result === "no"
      ? market.result
      : undefined;
  // Kalshi's market titles are already specific ("Will Klaus Iohannis be…");
  // in a multi-market event the Yes subtitle names the option.
  const multi =
    !!event && (event.mutually_exclusive || (event.markets?.length ?? 0) > 1);
  const title = market.title;
  return {
    ref: { venueId: kalshi.id, externalId: market.ticker },
    eventRef: { venueId: kalshi.id, externalId: market.event_ticker },
    type: "binary",
    title,
    shortTitle:
      multi && market.yes_sub_title ? market.yes_sub_title : undefined,
    description: event?.title,
    rules:
      [market.rules_primary, market.rules_secondary]
        .filter(Boolean)
        .join("\n\n") || title,
    resolutionSource: series?.settlement_sources
      ?.map((s) => s.name)
      .filter(Boolean)
      .join(", "),
    categoryHints: [
      ...new Set(
        [event?.category, series?.category].filter((c): c is string => !!c),
      ),
    ],
    outcomes: [
      { key: "yes", label: "Yes", index: 0 },
      { key: "no", label: "No", index: 1 },
    ],
    status,
    currency: kalshi.collateral,
    tick: tiers ? Math.min(...tiers.map((r) => r.step)) : price("0.0100"),
    priceRanges: tiers,
    quantityScale: QUANTITY_SCALE,
    quantityStep: 1,
    venueFee: feeModel(series),
    opensAt: market.open_time,
    closesAt: market.close_time,
    expectedResolutionAt: market.expected_expiration_time ?? undefined,
    resolution: result
      ? { outcome: result, final: status === "resolved", resolvedAt: undefined }
      : undefined,
    // Kalshi counts volume and open interest in contracts, each $1 of
    // notional; canonical stats are money (micro-dollars).
    stats: {
      volume: market.volume_fp
        ? contractsToMicros(market.volume_fp)
        : undefined,
      openInterest: market.open_interest_fp
        ? contractsToMicros(market.open_interest_fp)
        : undefined,
      volume24h: market.volume_24h_fp
        ? contractsToMicros(market.volume_24h_fp)
        : undefined,
      liquidity: market.liquidity_dollars
        ? price(market.liquidity_dollars)
        : undefined,
    },
    snapshot: snapshotOf(market),
  };
}

/** Top of book and the move since a day ago (`previous_price` is the last
    price 24 hours earlier). */
function snapshotOf(market: KalshiMarket): CanonicalMarket["snapshot"] {
  const last = quoted(market.last_price_dollars);
  const previous = quoted(market.previous_price_dollars);
  return {
    yesBid: quoted(market.yes_bid_dollars),
    yesAsk: quoted(market.yes_ask_dollars),
    last,
    change24h:
      last !== undefined && previous !== undefined ? last - previous : undefined,
  };
}

/** Kalshi publishes bids only, ascending: best is last. Asks on each side are
    the other side's bids, complemented. */
export function toBook(
  ticker: string,
  book: z.infer<typeof OrderbookResponse>["orderbook_fp"],
  at: string,
): Book {
  const bids = (levels: [string, string][] | null | undefined): BookLevel[] =>
    (levels ?? [])
      .map(([p, q]) => ({ price: price(p), quantity: quantity(q) }))
      .filter((l) => l.quantity > 0)
      .sort((a, b) => b.price - a.price);
  const yesBids = bids(book.yes_dollars);
  const noBids = bids(book.no_dollars);
  return {
    ref: { venueId: kalshi.id, externalId: ticker },
    at,
    outcomes: [
      { outcome: "yes", bids: yesBids, asks: complementLevels(noBids, ONE) },
      { outcome: "no", bids: noBids, asks: complementLevels(yesBids, ONE) },
    ],
  };
}

export function toTrades(page: z.infer<typeof TradesResponse>): Trade[] {
  return page.trades.map((trade) => ({
    ref: { venueId: kalshi.id, externalId: trade.ticker },
    outcome: "yes",
    price: price(trade.yes_price_dollars),
    quantity: quantity(trade.count_fp),
    at: trade.created_time,
    side: trade.taker_outcome_side === "no" ? "sell" : "buy",
  }));
}

/** Candles in Yes-price terms; periods without a trade carry the previous
    close forward so the chart has no holes. */
export function toCandles(
  page: z.infer<typeof CandlesResponse>,
  periodSeconds: number,
): Candle[] {
  let last: number | undefined;
  const out: Candle[] = [];
  for (const c of page.candlesticks) {
    const close = c.price.close_dollars ? price(c.price.close_dollars) : last;
    if (close === undefined) continue;
    const open = c.price.open_dollars
      ? price(c.price.open_dollars)
      : (last ?? close);
    const high = c.price.high_dollars
      ? price(c.price.high_dollars)
      : Math.max(open, close);
    const low = c.price.low_dollars
      ? price(c.price.low_dollars)
      : Math.min(open, close);
    out.push({
      start: new Date((c.end_period_ts - periodSeconds) * 1000).toISOString(),
      open,
      high: Math.max(high, open, close),
      low: Math.min(low, open, close),
      close,
      volume: c.volume_fp ? quantity(c.volume_fp) : undefined,
    });
    last = close;
  }
  return out;
}
