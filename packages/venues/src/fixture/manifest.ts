/**
 * The fixture venue: deterministic and fully controllable, with every
 * capability switched on so the conformance kit exercises all of them. It
 * backs tests and the demo profile; it never appears to real users.
 */
import { MARKET_STATUSES, type MarketStatus } from "@imo/core/lifecycle";
import { defineVenue } from "../sdk/manifest";

export const fixture = defineVenue({
  id: "fixture",
  kind: "exchange",
  collateral: "USD",
  display: {
    name: "Fixture Exchange",
    mark: "F",
    color: "#8b8f98",
    chip: { background: "#252832", foreground: "#c3c7cd" },
    feeLabel: "Fixture trading fee",
    settlementCopy: "Settled by the fixture",
  },
  capabilities: {
    marketTypes: ["binary"],
    orderTypes: ["market", "limit"],
    timeInForce: ["ioc", "fok", "gtc", "gtd"],
    fractionalQuantity: false,
    tick: "per-market",
    streaming: {
      quotes: true,
      book: "snapshot",
      trades: true,
      lifecycle: true,
    },
    history: { candleIntervals: ["1h", "1d"] },
    settlement: { kind: "exchange", disputes: true },
    pauses: ["trading", "exchange"],
  },
  fees: {
    default: {
      kind: "quadratic",
      rate: "0.07",
      appliesTo: "taker",
      rounding: { mode: "ceil", decimals: 6 },
    },
  },
  // The fixture speaks canonical statuses natively.
  statusMap: Object.fromEntries(
    MARKET_STATUSES.map((status) => [status, status]),
  ) as Record<string, MarketStatus>,
  dataRights: {
    display: true,
    quoteTtlSeconds: 5,
    storeCandles: true,
    storeTrades: true,
  },
});
