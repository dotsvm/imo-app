/**
 * Polymarket → canonical. A market is a condition with a Yes and a No token;
 * books, prices and history are per token. The CLOB lists bids ascending and
 * asks descending (best last), so both are re-sorted best-first.
 */
import type { FeeModel } from "@imo/core/fees";
import type { MarketStatus } from "@imo/core/lifecycle";
import type {
  Book,
  BookLevel,
  CanonicalMarket,
  Candle,
  Trade,
} from "@imo/core/market";
import { parseUnits } from "@imo/core/money";
import { defaultFee, mapStatus } from "../sdk/manifest";
import { polymarket } from "./manifest";
import type {
  ClobBook,
  DataTrades,
  GammaMarket,
  PriceHistory,
} from "./schemas";
import type { z } from "zod";

export const QUANTITY_SCALE = 2;
export const price = (decimal: string) => parseUnits(decimal, 6, "half-up");
export const size = (decimal: string) =>
  parseUnits(decimal, QUANTITY_SCALE, "floor");

/** Only Yes/No markets with both tokens are listed in the beta. */
export function yesNoTokens(
  market: GammaMarket,
): { yes: string; no: string } | null {
  const outcomes = market.outcomes?.map((o) => o.toLowerCase());
  const tokens = market.clobTokenIds;
  if (!outcomes || !tokens || outcomes.length !== 2 || tokens.length !== 2)
    return null;
  const yes = outcomes.indexOf("yes");
  const no = outcomes.indexOf("no");
  return yes < 0 || no < 0 ? null : { yes: tokens[yes], no: tokens[no] };
}

export function statusOf(market: GammaMarket): MarketStatus {
  if (market.archived) return mapStatus(polymarket, "archived");
  const uma = market.umaResolutionStatus?.toLowerCase();
  if (uma === "resolved") return mapStatus(polymarket, "resolved");
  if (uma === "disputed") return mapStatus(polymarket, "disputed");
  if (uma === "proposed") return mapStatus(polymarket, "proposed");
  if (market.closed) return mapStatus(polymarket, "closed");
  if (market.acceptingOrders === false) return mapStatus(polymarket, "paused");
  return market.active ? mapStatus(polymarket, "active") : "unknown";
}

/** A resolved market's payout vector: ["1","0"] is Yes, ["0","1"] is No,
    an even split is a void (50-50) resolution. */
function resolutionOf(
  market: GammaMarket,
  status: MarketStatus,
): CanonicalMarket["resolution"] {
  if (status !== "resolved" && status !== "determined" && status !== "disputed")
    return undefined;
  const outcomes = market.outcomes?.map((o) => o.toLowerCase());
  const prices = market.outcomePrices?.map(Number);
  if (!outcomes || !prices || prices.length !== outcomes.length)
    return undefined;
  const winner = prices.findIndex((p) => p === 1);
  const outcome =
    winner >= 0
      ? outcomes[winner]
      : prices.every((p) => p === prices[0])
        ? "void"
        : undefined;
  return outcome ? { outcome, final: status === "resolved" } : undefined;
}

const tagsOf = (market: GammaMarket) =>
  [
    ...(market.tags ?? []),
    ...(market.events ?? []).flatMap((e) => e.tags ?? []),
  ].flatMap((t) => [t.slug, t.label].filter((v): v is string => !!v));

/** The market's own fee rate when published; otherwise its category default. */
export function feeModel(market: GammaMarket): FeeModel {
  if (market.feesEnabled === false) return { kind: "none" };
  if (market.takerFeeRate !== undefined)
    return {
      kind: "quadratic",
      rate: market.takerFeeRate,
      appliesTo: "taker",
      rounding: { mode: "ceil", decimals: 6 },
    };
  const categories = [market.category, ...tagsOf(market)]
    .filter(Boolean)
    .map((c) => c!.toLowerCase());
  const known = categories.find((c) => polymarket.fees.byCategory?.[c]);
  return defaultFee(polymarket, known);
}

/** An ISO time Postgres can store (years 1–9999), or undefined. */
function validDate(value: string | undefined) {
  if (!value) return undefined;
  const at = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(at)) return undefined;
  const year = new Date(at).getUTCFullYear();
  return year >= 1 && year <= 9999 ? new Date(at).toISOString() : undefined;
}

export function toCanonicalMarket(market: GammaMarket): CanonicalMarket | null {
  const tokens = yesNoTokens(market);
  if (!tokens) return null;
  const status = statusOf(market);
  const event = market.events?.[0];
  // When it closes: the market's own end, its date-only end, or its event's.
  // A market with none can't say when it settles, so it isn't listed.
  const closesAt = validDate(market.endDate) ?? validDate(market.endDateIso) ?? validDate(event?.endDate);
  if (!closesAt) return null;
  return {
    ref: { venueId: polymarket.id, externalId: market.conditionId },
    eventRef: event
      ? { venueId: polymarket.id, externalId: event.id }
      : undefined,
    type: "binary",
    title: market.question,
    description: market.description,
    rules: market.description || market.question,
    resolutionSource: market.resolutionSource || undefined,
    categoryHints: [
      ...new Set(
        [market.category, ...tagsOf(market)].filter((c): c is string => !!c),
      ),
    ],
    outcomes: [
      { key: "yes", label: "Yes", index: 0, externalId: tokens.yes },
      { key: "no", label: "No", index: 1, externalId: tokens.no },
    ],
    status,
    currency: polymarket.collateral,
    tick: market.orderPriceMinTickSize
      ? price(market.orderPriceMinTickSize)
      : price("0.01"),
    quantityScale: QUANTITY_SCALE,
    quantityStep: 1,
    venueFee: feeModel(market),
    opensAt: market.startDate,
    closesAt,
    resolution: resolutionOf(market, status),
    stats: {
      volume: market.volumeNum ? price(market.volumeNum) : undefined,
      volume24h: market.volume24hr ? price(market.volume24hr) : undefined,
      liquidity: market.liquidityNum ? price(market.liquidityNum) : undefined,
    },
    snapshot: snapshotOf(market),
  };
}

const ONE = 1_000_000;
const quoted = (decimal?: string) => {
  if (decimal === undefined) return undefined;
  const p = price(decimal);
  return p > 0 && p < ONE ? p : undefined;
};

/** Gamma's best bid, ask, last price and day change describe the first
    outcome; when that's No, the Yes view is their complement. */
function snapshotOf(market: GammaMarket): CanonicalMarket["snapshot"] {
  const bid = quoted(market.bestBid);
  const ask = quoted(market.bestAsk);
  const last = quoted(market.lastTradePrice);
  const change =
    market.oneDayPriceChange !== undefined
      ? price(market.oneDayPriceChange)
      : undefined;
  if (market.outcomes?.[0]?.toLowerCase() !== "no")
    return { yesBid: bid, yesAsk: ask, last, change24h: change };
  const flip = (v?: number) => (v === undefined ? undefined : ONE - v);
  return {
    yesBid: flip(ask),
    yesAsk: flip(bid),
    last: flip(last),
    change24h: change === undefined ? undefined : -change,
  };
}

const levels = (
  list: z.infer<typeof ClobBook>["bids"],
  best: "high" | "low",
): BookLevel[] =>
  list
    .map((l) => ({ price: price(l.price), quantity: size(l.size) }))
    .filter((l) => l.quantity > 0)
    .sort((a, b) => (best === "high" ? b.price - a.price : a.price - b.price));

/** One canonical book from the Yes and No token books. */
export function toBook(
  conditionId: string,
  yes: z.infer<typeof ClobBook> | undefined,
  no: z.infer<typeof ClobBook> | undefined,
  at: string,
): Book {
  return {
    ref: { venueId: polymarket.id, externalId: conditionId },
    at,
    outcomes: [
      {
        outcome: "yes",
        bids: levels(yes?.bids ?? [], "high"),
        asks: levels(yes?.asks ?? [], "low"),
      },
      {
        outcome: "no",
        bids: levels(no?.bids ?? [], "high"),
        asks: levels(no?.asks ?? [], "low"),
      },
    ],
  };
}

/** Epoch seconds from seconds, milliseconds, or an ISO time. */
function epochSeconds(value: number | string | undefined) {
  if (value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(n)) return n > 1e12 ? Math.floor(n / 1000) : n;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? undefined : Math.floor(parsed / 1000);
}

export function toCandles(
  page: z.infer<typeof PriceHistory>,
  bucketSeconds: number,
): Candle[] {
  return page.history
    .flatMap((point) => {
      const at = epochSeconds(point.t ?? point.timestamp);
      const value = point.p ?? point.price;
      if (at === undefined || value === undefined) return [];
      const p = price(String(value));
      return [
        {
          start: new Date((at - bucketSeconds) * 1000).toISOString(),
          open: p,
          high: p,
          low: p,
          close: p,
        },
      ];
    })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

export function toTrades(
  conditionId: string,
  yesToken: string,
  rows: z.infer<typeof DataTrades>,
): Trade[] {
  return rows.map((row) => {
    const onYes = row.asset === yesToken;
    const p = price(row.price);
    return {
      ref: { venueId: polymarket.id, externalId: conditionId },
      outcome: "yes",
      price: onYes ? p : 1_000_000 - p,
      quantity: size(row.size),
      at: new Date(
        typeof row.timestamp === "number"
          ? row.timestamp * 1000
          : Date.parse(row.timestamp),
      ).toISOString(),
      side: row.side?.toUpperCase() === "SELL" ? "sell" : "buy",
    };
  });
}
