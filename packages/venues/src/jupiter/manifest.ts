/**
 * Jupiter Predict — Solana prediction markets that route to Kalshi and
 * Polymarket books, settling in USD stablecoins (USDC / JupUSD) onchain.
 * Facts from developers.jup.ag/docs/prediction and
 * docs.jup.ag/user-docs/trade/predict, checked October 7, 2026.
 */
import type { FeeModel } from "@imo/core/fees";
import { defineCurrency } from "@imo/core/money";
import { defineVenue } from "../sdk/manifest";

// Predict quotes and settles in micro USD (1,000,000 = $1.00).
defineCurrency({ code: "USDC", scale: 6, displayDecimals: 2, symbol: "$" });

/** Taker-only: C × feeRate × p × (1 − p). */
export const jupiterTaker = (rate: string): FeeModel => ({
  kind: "quadratic",
  rate,
  appliesTo: "taker",
  rounding: { mode: "ceil", decimals: 6 },
});

export const jupiter = defineVenue({
  id: "jupiter",
  kind: "protocol",
  collateral: "USDC",
  display: {
    name: "Jupiter",
    mark: "J",
    logo: "/venues/jupiter.png",
    color: "#c7f284",
    chip: { background: "#13281d", foreground: "#c7f284" },
    feeLabel: "Jupiter + venue fee",
    settlementCopy: "Settled onchain on Solana from the source market's result",
  },
  capabilities: {
    // Multi-outcome events are groups of binary markets.
    marketTypes: ["binary"],
    orderTypes: ["market"],
    timeInForce: ["ioc"],
    fractionalQuantity: true,
    // Polymarket-sourced books step in 0.1¢, Kalshi-sourced in 1¢.
    tick: "per-market",
    // No public stream: books are polled.
    streaming: { quotes: false, book: "snapshot", trades: false, lifecycle: false },
    history: { candleIntervals: [] },
    settlement: { kind: "exchange", disputes: false },
    pauses: ["trading"],
  },
  fees: {
    // Polymarket-sourced markets: Jupiter adds a fee equal to Polymarket's,
    // so the trader pays twice Polymarket's taker rate. Kalshi-sourced
    // markets carry Kalshi's fee (see mappers → feeModel).
    default: jupiterTaker("0.10"),
    byCategory: {
      crypto: jupiterTaker("0.14"),
      sports: jupiterTaker("0.10"),
      politics: jupiterTaker("0.08"),
      economics: jupiterTaker("0.10"),
      culture: jupiterTaker("0.10"),
      tech: jupiterTaker("0.08"),
      esports: jupiterTaker("0.10"),
    },
  },
  statusMap: {
    open: "open",
    closed: "closed",
    resolved: "resolved",
    cancelled: "voided",
  },
  dataRights: {
    // A public API built for third-party apps; read without a key at a low
    // rate, or with JUPITER_API_KEY at the plan's rate.
    display: true,
    quoteTtlSeconds: 10,
    storeCandles: false,
    storeTrades: false,
    attribution: "Market data from Jupiter Predict",
  },
});
