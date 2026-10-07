/**
 * Kalshi — a CFTC-regulated exchange. Facts from docs.kalshi.com, checked
 * September 29, 2026; see README.md in this folder for the API notes.
 */
import { defineVenue } from "../sdk/manifest";

export const kalshi = defineVenue({
  id: "kalshi",
  kind: "exchange",
  collateral: "USD",
  display: {
    name: "Kalshi",
    mark: "K",
    logo: "/venues/kalshi.png",
    color: "#09c285",
    chip: { background: "#2b3b28", foreground: "#c2dfb9" },
    feeLabel: "Kalshi trading fee",
    settlementCopy: "Settled by Kalshi",
  },
  capabilities: {
    marketTypes: ["binary"],
    orderTypes: ["market", "limit"],
    timeInForce: ["ioc", "fok", "gtc", "gtd"],
    // Sizes are fixed-point (`count_fp`) and prices can be subpenny.
    fractionalQuantity: true,
    tick: "per-market",
    streaming: { quotes: true, book: "delta", trades: true, lifecycle: true },
    history: { candleIntervals: ["1m", "1h", "1d"] },
    // `determined` stays disputable for `settlement_timer_seconds`.
    settlement: { kind: "exchange", disputes: true },
    pauses: ["trading", "exchange"],
  },
  fees: {
    // 0.07 × contracts × p × (1 − p), rounded up to $0.000001. Series and
    // events can override it; the source reads those per market.
    default: {
      kind: "quadratic",
      rate: "0.07",
      appliesTo: "taker",
      rounding: { mode: "ceil", decimals: 6 },
    },
  },
  statusMap: {
    initialized: "upcoming",
    active: "open",
    inactive: "paused",
    closed: "closed",
    determined: "determined",
    disputed: "disputed",
    amended: "determined",
    finalized: "resolved",
    settled: "resolved",
  },
  schedule: {
    timeZone: "America/New_York",
    maintenance: [
      {
        rrule: "FREQ=WEEKLY;BYDAY=TH;BYHOUR=3;BYMINUTE=0",
        minutes: 120,
        kind: "trading",
      },
    ],
  },
  dataRights: {
    // Off until Kalshi grants written consent (Kalshi Builders). The Data
    // Terms of Use forbid public display without it.
    display: false,
    quoteTtlSeconds: 5,
    storeCandles: false,
    storeTrades: false,
    attribution: "Market data from Kalshi",
  },
});
