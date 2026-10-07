/**
 * Kalshi Trade API v2 payloads, as recorded from the demo environment
 * (September 29, 2026). Loose objects: unknown fields pass through, missing
 * ones we rely on fail loudly at the edge.
 */
import { z } from "zod";

const dollars = z.string().regex(/^-?\d+(\.\d+)?$/);
const fixed = z.string().regex(/^-?\d+(\.\d+)?$/);

export const KalshiMarket = z.looseObject({
  ticker: z.string(),
  event_ticker: z.string(),
  market_type: z.string(),
  title: z.string(),
  yes_sub_title: z.string().optional().default(""),
  no_sub_title: z.string().optional().default(""),
  status: z.string(),
  open_time: z.string().optional(),
  close_time: z.string(),
  expected_expiration_time: z.string().nullish(),
  latest_expiration_time: z.string().nullish(),
  settlement_timer_seconds: z.number().optional(),
  yes_bid_dollars: dollars.optional(),
  yes_ask_dollars: dollars.optional(),
  last_price_dollars: dollars.optional(),
  previous_price_dollars: dollars.optional(),
  volume_fp: fixed.optional(),
  volume_24h_fp: fixed.optional(),
  open_interest_fp: fixed.optional(),
  liquidity_dollars: dollars.optional(),
  notional_value_dollars: dollars.optional(),
  result: z.string().optional().default(""),
  rules_primary: z.string().optional().default(""),
  rules_secondary: z.string().optional().default(""),
  price_level_structure: z.string().optional(),
  price_ranges: z
    .array(z.object({ start: dollars, end: dollars, step: dollars }))
    .optional(),
  mve_collection_ticker: z.string().optional(),
});
export type KalshiMarket = z.infer<typeof KalshiMarket>;

export const KalshiEvent = z.looseObject({
  event_ticker: z.string(),
  series_ticker: z.string(),
  title: z.string(),
  sub_title: z.string().optional().default(""),
  category: z.string().optional().default(""),
  mutually_exclusive: z.boolean().optional(),
  markets: z.array(KalshiMarket).optional(),
});
export type KalshiEvent = z.infer<typeof KalshiEvent>;

export const EventsPage = z.object({
  events: z.array(KalshiEvent),
  cursor: z.string().optional().default(""),
});

export const MarketResponse = z.object({ market: KalshiMarket });
export const EventResponse = z.object({
  event: KalshiEvent,
  markets: z.array(KalshiMarket).optional(),
});

export const KalshiSeries = z.looseObject({
  ticker: z.string(),
  category: z.string().optional().default(""),
  fee_type: z.string().optional().default("quadratic"),
  fee_multiplier: z.number().optional().default(1),
  settlement_sources: z
    .array(
      z.looseObject({
        name: z.string().optional(),
        url: z.string().optional(),
      }),
    )
    .optional(),
});
export const SeriesResponse = z.object({ series: KalshiSeries });

const Level = z.tuple([dollars, fixed]);
export const OrderbookResponse = z.object({
  orderbook_fp: z.object({
    yes_dollars: z.array(Level).nullish(),
    no_dollars: z.array(Level).nullish(),
  }),
});
export const OrderbooksResponse = z.object({
  orderbooks: z.array(
    z.object({
      ticker: z.string(),
      orderbook_fp: OrderbookResponse.shape.orderbook_fp,
    }),
  ),
});

export const TradesResponse = z.object({
  trades: z.array(
    z.looseObject({
      trade_id: z.string(),
      ticker: z.string(),
      yes_price_dollars: dollars,
      no_price_dollars: dollars,
      count_fp: fixed,
      taker_outcome_side: z.string().optional(),
      created_time: z.string(),
    }),
  ),
  cursor: z.string().optional().default(""),
});

const Ohlc = z.object({
  open_dollars: dollars.nullish(),
  high_dollars: dollars.nullish(),
  low_dollars: dollars.nullish(),
  close_dollars: dollars.nullish(),
});
export const CandlesResponse = z.object({
  candlesticks: z.array(
    z.looseObject({
      end_period_ts: z.number(),
      price: Ohlc.extend({
        mean_dollars: dollars.nullish(),
        previous_dollars: dollars.nullish(),
      }),
      yes_bid: Ohlc.optional(),
      yes_ask: Ohlc.optional(),
      volume_fp: fixed.optional(),
    }),
  ),
});

export const ExchangeStatus = z.looseObject({
  exchange_active: z.boolean(),
  trading_active: z.boolean(),
  exchange_estimated_resume_time: z.string().nullish(),
});
