/**
 * Jupiter Predict payloads (api.jup.ag/prediction/v1), only the fields we
 * read. Unknown fields pass through; a market that doesn't parse is skipped
 * by the source, never fatal to a page.
 */
import { z } from "zod";

/** Micro USD as a number or a numeric string. */
const micro = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)]).transform(Number);

export const JupiterMarket = z.looseObject({
  marketId: z.string().min(1),
  eventId: z.string().optional(),
  provider: z.string().optional(),
  title: z.string(),
  status: z.string(),
  result: z.string().nullable().optional(),
  openTime: z.number().nullable().optional(),
  closeTime: z.number().nullable().optional(),
  resolveAt: z.string().nullable().optional(),
  rulesPrimary: z.string().nullable().optional(),
  rulesSecondary: z.string().nullable().optional(),
  outcomes: z.array(z.string()).nullable().optional(),
  pricing: z
    .looseObject({
      buyYesPriceUsd: micro.nullable().optional(),
      sellYesPriceUsd: micro.nullable().optional(),
      buyNoPriceUsd: micro.nullable().optional(),
      sellNoPriceUsd: micro.nullable().optional(),
      /** Traded, in whole dollars. */
      volume: micro.nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type JupiterMarket = z.infer<typeof JupiterMarket>;

export const JupiterEvent = z.looseObject({
  eventId: z.string(),
  isActive: z.boolean().optional(),
  category: z.string().nullable().optional(),
  subcategory: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  metadata: z
    .looseObject({
      title: z.string().optional(),
      subtitle: z.string().nullable().optional(),
      closeTime: z.string().nullable().optional(),
    })
    .optional(),
  volume24hr: micro.nullable().optional(),
  markets: z.array(z.unknown()).optional(),
});
export type JupiterEvent = z.infer<typeof JupiterEvent>;

export const EventsPage = z.object({
  data: z.array(z.unknown()),
  pagination: z.object({ start: z.number(), end: z.number(), hasNext: z.boolean() }).optional(),
});

/** Bids per side as [price in cents, contracts], ascending by price. */
const Levels = z.array(z.tuple([z.number(), z.number()])).nullable().optional();
export const Orderbook = z.looseObject({ yes: Levels, no: Levels });

export const TradingStatus = z.object({ trading_active: z.boolean() });
