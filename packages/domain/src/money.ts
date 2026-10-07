import { feeFor as modelFee, type FeeModel } from "@imo/core/fees";
import { complement } from "@imo/core/market";
import type { Cents, Market, Outcome } from "./types";
export const usd = (cents: Cents, digits = 2) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 100);
/** Gains with a plus, losses with a true minus; nothing is just $0.00. */
export const signedUsd = (cents: Cents) =>
  cents === 0 ? usd(0) : `${cents > 0 ? "+" : "−"}${usd(Math.abs(cents))}`;
export const compactUsd = (cents: Cents) =>
  `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(cents / 100)}`;
/** Gains carry ▲ and a plus, losses ▼ and a true minus — never colour alone.
    Nothing gained or lost carries neither. */
export const arrowUsd = (cents: Cents) =>
  cents === 0 ? usd(0) : `${cents > 0 ? "▲" : "▼"} ${signedUsd(cents)}`;
/** The colour class for a gain or a loss; none for zero. */
export const tone = (n: number) => (n > 0 ? "positive" : n < 0 ? "negative" : "");
/** A percentage change with its sign ("+2.3%", "−1.0%", "0.0%"). */
export const signedPct = (n: number, digits = 1) =>
  `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(digits)}%`;
/** A price for reading: whole cents as they are, else to a tenth — an
    average across book levels ("64.3¢"). */
export const centsText = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}¢`;
export function parseDollars(value: string): Cents | null {
  if (!/^\d{1,7}(\.\d{0,2})?$/.test(value.trim())) return null;
  const [dollars, fraction = ""] = value.trim().split(".");
  return Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));
}
export const priceFor = (market: Market, outcome: Outcome) =>
  market.status === "resolved"
    ? market.resolution.outcome === outcome
      ? 100
      : 0
    : outcome === "Yes"
      ? market.yesPrice
      : complement(market.yesPrice);
/** This module prices in cents: scale 2, whole shares. */
const CENTS = { quantityScale: 0, quantityStep: 1, currencyScale: 2 } as const;
const fill = (priceCents: Cents, shares: number) => ({
  price: priceCents,
  quantity: shares,
  ...CENTS,
  liquidity: "taker" as const,
});
/** Hunch's 0.5% of notional, always its own line on the ticket. */
export const APP_FEE: FeeModel = {
  kind: "bps",
  bps: 50,
  appliesTo: "both",
  rounding: { mode: "half-up", decimals: 2 },
};
/**
 * Each market carries its venue's fee as data, and Hunch adds 0.5% of
 * notional. The design shows both as separate lines.
 */
export const venueFeeFor = (
  market: Market,
  shares: number,
  priceCents: Cents,
): Cents => modelFee(market.venueFee, fill(priceCents, shares));
export const appFeeFor = (notionalCents: Cents): Cents =>
  modelFee(APP_FEE, fill(notionalCents, 1));
export const feeFor = (
  market: Market,
  shares: number,
  priceCents: Cents,
): Cents =>
  venueFeeFor(market, shares, priceCents) + appFeeFor(shares * priceCents);
/** 05.5: the smallest order the venues accept. */
export const MIN_ORDER_CENTS = 100;
