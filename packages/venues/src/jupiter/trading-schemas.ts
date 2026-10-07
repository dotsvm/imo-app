/**
 * Jupiter Predict trading payloads (orders, positions, claims, history), from
 * the OpenAPI spec at developers.jup.ag/docs/openapi-spec/prediction/prediction.yaml
 * (October 7, 2026). Amounts are micro USD as decimal strings; contracts come
 * as `*Micro` (exact), `*Decimal` (display) and a floored legacy `contracts`.
 * Only the exact forms are read.
 */
import { z } from "zod";

/** A u64 as a decimal string (or, now and then, a number). */
const u64 = z.union([z.string().regex(/^-?\d+$/), z.number().int()]).transform(Number);
const optU64 = u64.nullable().optional();

const TxMeta = z.object({ blockhash: z.string(), lastValidBlockHeight: z.number().int() });

export const CreateOrderResponse = z.looseObject({
  transaction: z.string().nullable(),
  txMeta: TxMeta.nullable(),
  externalOrderId: z.string().nullable().optional(),
  requiredSigners: z.array(z.string()).optional(),
  execution: z.looseObject({ endpoint: z.string(), context: z.record(z.string(), z.unknown()) }).optional(),
  executionModel: z.string().nullable().optional(),
  order: z.looseObject({
    orderPubkey: z.string().nullable(),
    positionPubkey: z.string(),
    marketId: z.string(),
    isBuy: z.boolean(),
    isYes: z.boolean(),
    contractsMicro: optU64,
    newContractsMicro: optU64,
    orderCostUsd: optU64,
    newAvgPriceUsd: optU64,
    newPayoutUsd: optU64,
    payoutUsd: optU64,
    maxBuyPriceUsd: optU64,
    minSellPriceUsd: optU64,
    estimatedProtocolFeeUsd: optU64,
    estimatedVenueFeeUsd: optU64,
    estimatedTotalFeeUsd: optU64,
    slippageBps: z.number().int().nullable().optional(),
  }),
});
export type CreateOrderResponse = z.infer<typeof CreateOrderResponse>;

export const ExecuteResponse = z.looseObject({
  status: z.enum(["Success", "Failed"]),
  signature: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});

export const OrderStatusResponse = z.looseObject({
  orderPubkey: z.string(),
  status: z.string(),
  latestEventType: z.string().optional(),
  latestSignature: z.string().optional(),
});

export const HistoryEvent = z.looseObject({
  id: z.union([z.number(), z.string()]).transform(String),
  eventType: z.string(),
  signature: z.string().optional(),
  timestamp: z.number(),
  orderPubkey: z.string().nullable().optional(),
  positionPubkey: z.string().nullable().optional(),
  marketId: z.string().optional(),
  isBuy: z.boolean().optional(),
  isYes: z.boolean().optional(),
  filledContractsMicro: optU64,
  avgFillPriceUsd: optU64,
  totalCostUsd: optU64,
  grossProceedsUsd: optU64,
  feeUsd: optU64,
  payoutAmountUsd: optU64,
});
export type HistoryEvent = z.infer<typeof HistoryEvent>;

export const HistoryPage = z.object({
  data: z.array(z.unknown()),
  pagination: z.looseObject({ hasNext: z.boolean().optional() }).optional(),
});

export const Position = z.looseObject({
  pubkey: z.string(),
  marketId: z.string(),
  isYes: z.boolean(),
  contractsMicro: optU64,
  totalCostUsd: optU64,
  avgPriceUsd: optU64,
  valueUsd: optU64,
  markPriceUsd: optU64,
  feesPaidUsd: optU64,
  realizedPnlUsd: z.number().nullable().optional(),
  payoutUsd: optU64,
  claimable: z.boolean().optional(),
  claimed: z.boolean().optional(),
  claimedUsd: optU64,
  openOrders: z.number().int().optional(),
  openedAt: z.number().nullable().optional(),
});
export type Position = z.infer<typeof Position>;

export const PositionsPage = z.object({
  data: z.array(z.unknown()),
  pagination: z.looseObject({ hasNext: z.boolean().optional(), end: z.number().optional() }).optional(),
});

export const ClaimResponse = z.looseObject({
  transaction: z.string(),
  txMeta: TxMeta,
  position: z.looseObject({ positionPubkey: z.string(), payoutAmountUsd: optU64 }),
});

/** Every error: `{ type, message, code?, param?, request_id }`. */
export const ErrorBody = z.looseObject({
  type: z.string().optional(),
  message: z.string().optional(),
  code: z.string().optional(),
});
