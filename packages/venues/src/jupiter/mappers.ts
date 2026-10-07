/**
 * Jupiter Predict → canonical. An event holds one or more binary markets;
 * each market prices Yes and No in micro USD. Books list bids only, per
 * side, in cents and ascending: a No bid at p is a Yes ask at 100 − p.
 */
import type { FeeModel } from "@imo/core/fees";
import type { MarketStatus } from "@imo/core/lifecycle";
import type { Book, BookLevel, CanonicalMarket } from "@imo/core/market";
import { defaultFee, mapStatus } from "../sdk/manifest";
import { jupiter, jupiterTaker } from "./manifest";
import type { JupiterEvent, JupiterMarket, Orderbook } from "./schemas";
import type { z } from "zod";

export const ONE = 1_000_000;
export const QUANTITY_SCALE = 2;
const MICROS_PER_CENT = 10_000;

/** Kalshi's taker fee, which Kalshi-sourced markets carry. */
const KALSHI_FEE = jupiterTaker("0.07");

export function statusOf(market: JupiterMarket): MarketStatus {
  const state = market.status.toLowerCase();
  if (state === "cancelled") return mapStatus(jupiter, "cancelled");
  if (market.result === "yes" || market.result === "no") return mapStatus(jupiter, "resolved");
  return mapStatus(jupiter, state);
}

function resolutionOf(market: JupiterMarket, status: MarketStatus): CanonicalMarket["resolution"] {
  if (status === "voided") return { outcome: "void", final: true, resolvedAt: market.resolveAt ?? undefined };
  if (status !== "resolved") return undefined;
  return { outcome: market.result!, final: true, resolvedAt: market.resolveAt ?? undefined };
}

export function feeModel(market: JupiterMarket, event: JupiterEvent | undefined): FeeModel {
  if (market.provider === "kalshi") return KALSHI_FEE;
  return defaultFee(jupiter, event?.category?.toLowerCase() ?? undefined);
}

/** Polymarket books step in tenths of a cent, Kalshi's in cents. */
const tickOf = (market: JupiterMarket) => (market.provider === "kalshi" ? MICROS_PER_CENT : MICROS_PER_CENT / 10);

const inRange = (p: number | null | undefined) => (p != null && p > 0 && p < ONE ? Math.round(p) : undefined);

const iso = (seconds: number | null | undefined) => {
  if (!seconds || !Number.isFinite(seconds)) return undefined;
  const at = new Date((seconds > 1e12 ? seconds : seconds * 1000));
  const year = at.getUTCFullYear();
  return year >= 2000 && year <= 9999 ? at.toISOString() : undefined;
};

export function toCanonicalMarket(market: JupiterMarket, event: JupiterEvent | undefined): CanonicalMarket | null {
  const outcomes = (market.outcomes ?? ["Yes", "No"]).map((o) => o.toLowerCase());
  // Binary Yes/No only; head-to-head sports lines ("Team A"/"Team B") are left out.
  if (outcomes.length !== 2 || !outcomes.includes("yes") || !outcomes.includes("no")) return null;
  const closesAt = iso(market.closeTime) ?? (event?.metadata?.closeTime ? new Date(event.metadata.closeTime).toISOString() : undefined);
  if (!closesAt) return null;
  const status = statusOf(market);
  const eventTitle = event?.metadata?.title?.trim();
  const many = (event?.markets?.length ?? 1) > 1;
  // A market inside a multi-market event is named by its option ("Flávio Bolsonaro");
  // the question is the event plus that option.
  const title = many && eventTitle && !market.title.includes(eventTitle) ? `${eventTitle} · ${market.title}` : market.title;
  const pricing = market.pricing ?? undefined;
  const rules = [market.rulesPrimary, market.rulesSecondary].filter((r): r is string => !!r && !!r.trim()).join("\n\n");
  return {
    ref: { venueId: jupiter.id, externalId: market.marketId },
    eventRef: market.eventId ? { venueId: jupiter.id, externalId: market.eventId } : undefined,
    type: "binary",
    title,
    shortTitle: many ? market.title : undefined,
    description: rules || undefined,
    rules: rules || title,
    categoryHints: [
      ...new Set([event?.category, event?.subcategory, ...(event?.tags ?? [])].filter((c): c is string => !!c)),
    ],
    outcomes: [
      { key: "yes", label: "Yes", index: 0 },
      { key: "no", label: "No", index: 1 },
    ],
    status,
    currency: jupiter.collateral,
    tick: tickOf(market),
    quantityScale: QUANTITY_SCALE,
    quantityStep: 1,
    venueFee: feeModel(market, event),
    opensAt: iso(market.openTime),
    closesAt,
    resolution: resolutionOf(market, status),
    stats: {
      volume: pricing?.volume ? Math.round(pricing.volume * ONE) : undefined,
    },
    snapshot: {
      // What a seller gets is the Yes bid; what a buyer pays is the Yes ask.
      yesBid: inRange(pricing?.sellYesPriceUsd),
      yesAsk: inRange(pricing?.buyYesPriceUsd),
    },
  };
}

type Levels = z.infer<typeof Orderbook>["yes"];

const bids = (levels: Levels): BookLevel[] =>
  merge(
    (levels ?? [])
      .map(([cents, contracts]) => ({
        price: Math.round(cents * MICROS_PER_CENT),
        quantity: Math.floor(contracts * 10 ** QUANTITY_SCALE),
      }))
      .filter((l) => l.price > 0 && l.price < ONE && l.quantity > 0),
  ).sort((a, b) => b.price - a.price);

/** The other side's bids as this side's asks: a No bid at p is a Yes ask at 1 − p. */
const asksFrom = (otherBids: BookLevel[]): BookLevel[] =>
  otherBids.map((l) => ({ price: ONE - l.price, quantity: l.quantity })).sort((a, b) => a.price - b.price);

/** Jupiter repeats a price for each resting order; one level per price. */
function merge(levels: BookLevel[]): BookLevel[] {
  const byPrice = new Map<number, number>();
  for (const l of levels) byPrice.set(l.price, (byPrice.get(l.price) ?? 0) + l.quantity);
  return [...byPrice].map(([price, quantity]) => ({ price, quantity }));
}

export function toBook(marketId: string, book: z.infer<typeof Orderbook> | undefined, at: string): Book {
  const yes = bids(book?.yes);
  const no = bids(book?.no);
  return {
    ref: { venueId: jupiter.id, externalId: marketId },
    at,
    outcomes: [
      { outcome: "yes", bids: yes, asks: asksFrom(no) },
      { outcome: "no", bids: no, asks: asksFrom(yes) },
    ],
  };
}
