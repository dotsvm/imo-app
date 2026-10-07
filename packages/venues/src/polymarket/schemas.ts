/**
 * Polymarket payloads (Gamma, CLOB, Data API v2), from the documented REST
 * shapes (docs.polymarket.com, September 2026). Defensive on purpose: list
 * fields may arrive JSON-encoded, numbers as strings, and unknown fields pass
 * through. Re-record live fixtures from a region where the API is reachable.
 */
import { z } from "zod";

/** Numbers as plain decimal strings — never exponent notation, which
    String(1e-7) would produce and no decimal parser accepts. */
const num = z
  .union([z.number(), z.string()])
  .transform((v) =>
    typeof v === "number"
      ? v.toLocaleString("en-US", {
          useGrouping: false,
          maximumFractionDigits: 20,
        })
      : v,
  );
/** Gamma encodes some arrays as JSON strings: '["Yes","No"]'. */
const jsonList = z
  .union([z.array(z.string()), z.string()])
  .transform((v) => (Array.isArray(v) ? v : (JSON.parse(v) as string[])));

export const GammaTag = z.looseObject({
  id: z.union([z.string(), z.number()]).optional(),
  slug: z.string().optional(),
  label: z.string().optional(),
});

export const GammaMarket = z.looseObject({
  id: z.union([z.string(), z.number()]).transform(String),
  question: z.string(),
  conditionId: z.string(),
  slug: z.string().optional(),
  description: z.string().optional().default(""),
  resolutionSource: z.string().optional().default(""),
  endDate: z.string().optional(),
  /** A date-only end ("2026-11-03") some markets carry instead of endDate. */
  endDateIso: z.string().optional(),
  startDate: z.string().optional(),
  active: z.boolean().optional().default(true),
  closed: z.boolean().optional().default(false),
  archived: z.boolean().optional().default(false),
  acceptingOrders: z.boolean().optional(),
  outcomes: jsonList.optional(),
  outcomePrices: jsonList.optional(),
  clobTokenIds: jsonList.optional(),
  orderPriceMinTickSize: num.optional(),
  orderMinSize: num.optional(),
  negRisk: z.boolean().optional(),
  volumeNum: num.optional(),
  volume24hr: num.optional(),
  liquidityNum: num.optional(),
  lastTradePrice: num.optional(),
  bestBid: num.optional(),
  bestAsk: num.optional(),
  /** The first outcome's price move over a day, as a signed decimal. */
  oneDayPriceChange: num.optional(),
  umaResolutionStatus: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(GammaTag).optional(),
  events: z
    .array(
      z.looseObject({
        id: z.union([z.string(), z.number()]).transform(String),
        title: z.string().optional(),
        slug: z.string().optional(),
        endDate: z.string().optional(),
        tags: z.array(GammaTag).optional(),
      }),
    )
    .optional(),
  /** Fee Structure V2 fields, when the market publishes its own rates. */
  feesEnabled: z.boolean().optional(),
  takerFeeRate: num.optional(),
});
export type GammaMarket = z.infer<typeof GammaMarket>;

export const MarketsPage = z.object({
  markets: z.array(z.unknown()),
  next_cursor: z.string().nullish(),
});

const Level = z.object({ price: num, size: num });
export const ClobBook = z.looseObject({
  market: z.string().optional(),
  asset_id: z.string(),
  timestamp: z.union([z.string(), z.number()]).optional(),
  bids: z.array(Level).default([]),
  asks: z.array(Level).default([]),
  tick_size: num.optional(),
  min_order_size: num.optional(),
  last_trade_price: num.optional(),
});
export const ClobBooks = z.array(ClobBook);

/** A point in a token's price history. The docs show it both as `{ t, p }`
    and as `{ timestamp, price }`; either is read. */
const HistoryPoint = z.looseObject({
  t: z.union([z.number(), z.string()]).optional(),
  p: z.union([z.number(), z.string()]).optional(),
  timestamp: z.union([z.number(), z.string()]).optional(),
  price: z.union([z.number(), z.string()]).optional(),
});

export const PriceHistory = z.looseObject({
  history: z.array(HistoryPoint).default([]),
});

export const DataTrades = z.array(
  z.looseObject({
    asset: z.string(),
    side: z.string().optional(),
    size: num,
    price: num,
    timestamp: z.union([z.number(), z.string()]),
  }),
);
