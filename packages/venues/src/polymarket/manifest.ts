/**
 * Polymarket — an onchain protocol with an off-chain order book, settling in
 * pUSD on Polygon. Facts from docs.polymarket.com, checked September 29, 2026.
 */
import type { FeeModel } from "@imo/core/fees";
import { defineCurrency } from "@imo/core/money";
import { defineVenue } from "../sdk/manifest";

// pUSD replaced USDC.e as collateral with CLOB V2 (April 28, 2026).
defineCurrency({ code: "PUSD", scale: 6, displayDecimals: 2, symbol: "$" });

/** Taker-only: C × feeRate × p × (1 − p). Makers are never charged. */
const taker = (rate: string): FeeModel => ({
  kind: "quadratic",
  rate,
  appliesTo: "taker",
  rounding: { mode: "ceil", decimals: 6 },
});

export const polymarket = defineVenue({
  id: "polymarket",
  kind: "protocol",
  collateral: "PUSD",
  display: {
    name: "Polymarket",
    mark: "P",
    logo: "/venues/polymarket.png",
    color: "#2d6bff",
    chip: { background: "#ffffff", foreground: "#2d6bff" },
    feeLabel: "Polymarket taker fee",
    settlementCopy: "Resolved through the UMA optimistic oracle",
  },
  capabilities: {
    // Multi-outcome events are groups of binary markets (negative risk).
    marketTypes: ["binary"],
    orderTypes: ["market", "limit"],
    timeInForce: ["ioc", "fok", "gtc", "gtd"],
    fractionalQuantity: true,
    // Ticks change mid-life (`tick_size_change`): 0.01, 0.001, 0.0025.
    tick: "dynamic",
    streaming: { quotes: true, book: "delta", trades: true, lifecycle: true },
    history: { candleIntervals: ["1m", "1h", "1d"] },
    // Propose → 2-hour challenge → resolve; disputes can go to a DVM vote.
    settlement: { kind: "oracle", disputes: true },
    // Matching-engine restarts, then two minutes of post-only.
    pauses: ["exchange"],
  },
  fees: {
    // Rates per Polymarket category; a market's own fee fields win.
    default: taker("0.05"),
    byCategory: {
      crypto: taker("0.07"),
      sports: taker("0.05"),
      finance: taker("0.04"),
      politics: taker("0.04"),
      economics: taker("0.05"),
      culture: taker("0.05"),
      weather: taker("0.05"),
      mentions: taker("0.04"),
      tech: taker("0.04"),
      other: taker("0.05"),
      geopolitics: { kind: "none" },
    },
  },
  statusMap: {
    active: "open",
    paused: "paused",
    closed: "closed",
    proposed: "determined",
    disputed: "disputed",
    resolved: "resolved",
    archived: "delisted",
  },
  dataRights: {
    // Public APIs built for third-party builders; confirm the Terms before
    // storing history.
    display: true,
    quoteTtlSeconds: 5,
    storeCandles: false,
    storeTrades: false,
    attribution: "Market data from Polymarket",
  },
});
