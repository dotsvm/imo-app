/**
 * Jupiter Predict execution: orders, sells and claims as unsigned Solana
 * transactions for the trader's own wallet, landed through `POST /execute`
 * and filled by Jupiter's keepers. Mainnet only — Predict has no devnet.
 *
 *   build  POST /orders (buy, partial sell) · DELETE /positions/{pk} (sell all)
 *   land   POST /execute with the signed transaction and the build's context
 *   track  GET /orders/status/{order} · GET /history?positionPubkey= (fills)
 *   hold   GET /positions?ownerPubkey=
 *   claim  POST /positions/{pk}/claim
 *
 * Needs the JUPITER_API_KEY secret: keyless access is too slow to trade on.
 */
import { HttpError } from "@imo/core/ports/runtime";
import type { AdapterContext } from "../sdk/source";
import {
  type ClaimTicket,
  type ExecutionModule,
  type ExecutionVenue,
  type OrderRequest,
  type OrderTicket,
  type UnsignedTransaction,
  type VenueFill,
  type VenueOrderState,
  type WalletPosition,
  VenueRejection,
} from "../sdk/execution";
import { jupiter } from "./manifest";
import { QUANTITY_SCALE } from "./mappers";
import { JUPITER_HOST } from "./source";
import {
  ClaimResponse,
  CreateOrderResponse,
  ErrorBody,
  ExecuteResponse,
  HistoryEvent,
  HistoryPage,
  OrderStatusResponse,
  Position,
  PositionsPage,
} from "./trading-schemas";
import type { z } from "zod";

const BASE = `${JUPITER_HOST}/prediction/v1`;
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** $5: Jupiter rejects smaller orders. */
export const MIN_ORDER = 5_000_000;
/** Jupiter counts contracts in millionths; the catalog in hundredths. */
const MICRO_PER_UNIT = 10 ** (6 - QUANTITY_SCALE);
const POSITIONS_PAGE = 100;

const toUnits = (micro: number | null | undefined) => Math.floor((micro ?? 0) / MICRO_PER_UNIT);
const seconds = (s: number | null | undefined) => (s ? new Date(s * (s > 1e12 ? 1 : 1000)).toISOString() : undefined);

const STATES: Record<string, VenueOrderState> = {
  pending: "submitted",
  created: "open",
  partiallyfilled: "partial",
  filled: "filled",
  failed: "failed",
};

/** Jupiter's error, in terms the trader can act on. */
export function rejectionOf(error: unknown): VenueRejection | undefined {
  if (!(error instanceof HttpError) || error.status >= 500 || error.status === 429) return undefined;
  let body: z.infer<typeof ErrorBody> = {};
  try {
    body = ErrorBody.parse(JSON.parse(error.body ?? "{}"));
  } catch {
    // Not JSON (a gateway page): fall through with the status alone.
  }
  const code = body.code ?? "";
  const message = body.message ?? "";
  const text = `${code} ${message}`.toLowerCase();
  if (/restricted|region|country|jurisdiction/.test(text))
    return new VenueRejection("region_blocked", "Jupiter Predict isn't available in your region.", code);
  if (/minimum order/.test(text)) return new VenueRejection("min_order", "The minimum order is $5.", code);
  if (/insufficient/.test(text)) return new VenueRejection("insufficient_funds", "Not enough USDC in your wallet.", code);
  if (/no_shares_available|not enough shares/.test(text))
    return new VenueRejection("no_liquidity", "Not enough shares available right now. Try again shortly.", code);
  if (/not settled/.test(text)) return new VenueRejection("not_settled", "This market hasn't settled yet.", code);
  if (/closed|not tradable|not_tradable|inactive/.test(text))
    return new VenueRejection("market_closed", "This market isn't trading.", code);
  if (error.status === 404) return new VenueRejection("not_found", message || "Not found at Jupiter.", code);
  return new VenueRejection("rejected", message || `Jupiter declined the order (HTTP ${error.status}).`, code);
}

export function createJupiterExecution(ctx: AdapterContext): ExecutionVenue {
  const log = ctx.log.child({ venue: jupiter.id, source: "jupiter-execution" });
  let key: string | undefined | null = null;

  async function call<T>(
    path: string,
    schema: z.ZodType<T>,
    request: { method?: "GET" | "POST" | "DELETE"; body?: unknown } = {},
  ): Promise<T> {
    if (key === null) key = (await ctx.secrets.get("JUPITER_API_KEY")) || undefined;
    await ctx.rateLimiter.acquire("jupiter:trade", 1);
    try {
      const raw = await ctx.http.json(`${BASE}${path}`, {
        method: request.method ?? "GET",
        body: request.body,
        headers: key ? { "x-api-key": key } : undefined,
        // Builds and reads are safe to repeat; landing a transaction is not.
        idempotent: path !== "/execute",
        timeoutMs: 20_000,
      });
      return schema.parse(raw);
    } catch (error) {
      throw rejectionOf(error) ?? error;
    }
  }

  const unsigned = (
    transaction: string | null,
    meta: { blockhash: string; lastValidBlockHeight: number } | null,
    signers: string[],
    context?: unknown,
  ): UnsignedTransaction => {
    if (!transaction || !meta) throw new VenueRejection("rejected", "Jupiter returned no transaction to sign.");
    return { transaction, blockhash: meta.blockhash, lastValidBlockHeight: meta.lastValidBlockHeight, signers, context };
  };

  function ticketOf(built: CreateOrderResponse, owner: string): OrderTicket {
    const o = built.order;
    if (!o.orderPubkey) throw new VenueRejection("rejected", "Jupiter didn't open an order for this trade.");
    const signers = built.requiredSigners?.length ? built.requiredSigners : [owner];
    // Only the trader signs: refuse a build that asks for anyone else.
    if (signers.some((s) => s !== owner))
      throw new VenueRejection("rejected", "Jupiter's transaction asks for an unexpected signer.");
    const venueFee = o.estimatedVenueFeeUsd ?? 0;
    const protocolFee = o.estimatedProtocolFeeUsd ?? 0;
    const quantity = toUnits(o.contractsMicro);
    const notional = o.orderCostUsd ?? 0;
    return {
      tx: unsigned(built.transaction, built.txMeta, signers, built.execution?.context),
      orderId: o.orderPubkey,
      positionId: o.positionPubkey,
      estimate: {
        quantity,
        notional,
        price: (o.isBuy ? o.maxBuyPriceUsd : o.minSellPriceUsd) ?? o.newAvgPriceUsd ?? (quantity ? Math.round((notional * 10 ** QUANTITY_SCALE) / quantity) : 0),
        fees: { venue: venueFee, protocol: protocolFee, total: o.estimatedTotalFeeUsd ?? venueFee + protocolFee },
        payoutIfWins: o.newPayoutUsd ?? o.payoutUsd ?? 0,
        slippageBps: o.slippageBps ?? undefined,
      },
    };
  }

  function fillOf(e: HistoryEvent): VenueFill {
    const quantity = toUnits(e.filledContractsMicro);
    const price = e.avgFillPriceUsd ?? 0;
    return {
      id: `jupiter:${e.id}`,
      at: seconds(e.timestamp) ?? ctx.clock.now().toISOString(),
      price,
      quantity,
      notional: Math.round((quantity * price) / 10 ** QUANTITY_SCALE),
      fee: e.feeUsd ?? 0,
      signature: e.signature,
    };
  }

  function positionOf(p: Position): WalletPosition {
    return {
      id: p.pubkey,
      ref: { venueId: jupiter.id, externalId: p.marketId },
      outcome: p.isYes ? "yes" : "no",
      quantity: toUnits(p.contractsMicro),
      cost: p.totalCostUsd ?? 0,
      avgPrice: p.avgPriceUsd ?? 0,
      value: p.valueUsd ?? undefined,
      markPrice: p.markPriceUsd ?? undefined,
      fees: p.feesPaidUsd ?? 0,
      // Jupiter reports realized P&L in dollars here, not micro.
      realizedPnl: Math.round((p.realizedPnlUsd ?? 0) * 1_000_000),
      payout: p.payoutUsd ?? 0,
      claimable: !!p.claimable && !p.claimed,
      claimed: !!p.claimed,
      claimedAmount: p.claimedUsd ?? 0,
      openOrders: p.openOrders ?? 0,
      openedAt: seconds(p.openedAt),
    };
  }

  /** Fills for an order, from the owner's history (newest first). */
  async function fillsFor(orderId: string, owner: string): Promise<VenueFill[]> {
    const query = new URLSearchParams({ ownerPubkey: owner, start: "0", end: "50" });
    const page = await call(`/history?${query}`, HistoryPage);
    const out: VenueFill[] = [];
    for (const raw of page.data) {
      const parsed = HistoryEvent.safeParse(raw);
      if (!parsed.success) continue;
      const e = parsed.data;
      if (e.orderPubkey === orderId && e.eventType === "order_filled" && (e.filledContractsMicro ?? 0) > 0) out.push(fillOf(e));
    }
    return out.reverse();
  }

  return {
    minOrder: MIN_ORDER,

    async buildOrder(request: OrderRequest) {
      if (request.ref.venueId !== jupiter.id) throw new VenueRejection("not_found", "Not a Jupiter market.");
      if (request.side === "buy") {
        if (request.amount < MIN_ORDER) throw new VenueRejection("min_order", "The minimum order is $5.");
        const built = await call("/orders", CreateOrderResponse, {
          method: "POST",
          body: {
            ownerPubkey: request.owner,
            marketId: request.ref.externalId,
            isYes: request.outcome === "yes",
            isBuy: true,
            depositAmount: String(Math.floor(request.amount)),
            depositMint: USDC_MINT,
          },
        });
        return ticketOf(built, request.owner);
      }
      const built =
        request.quantity === "all"
          ? await call(`/positions/${encodeURIComponent(request.positionId)}`, CreateOrderResponse, {
              method: "DELETE",
              body: { ownerPubkey: request.owner },
            })
          : await call("/orders", CreateOrderResponse, {
              method: "POST",
              body: {
                ownerPubkey: request.owner,
                positionPubkey: request.positionId,
                isYes: request.outcome === "yes",
                isBuy: false,
                contractsMicro: String(request.quantity * MICRO_PER_UNIT),
              },
            });
      return ticketOf(built, request.owner);
    },

    async submit(signedTransaction, built) {
      const result = await call("/execute", ExecuteResponse, {
        method: "POST",
        body: { signedTransaction, ...(built.context ? { context: built.context } : {}) },
      });
      if (result.status !== "Success" || !result.signature)
        throw new VenueRejection("rejected", result.error || "The transaction didn't land. Nothing was charged.");
      return { signature: result.signature };
    },

    async orderStatus(orderId, owner) {
      let status: z.infer<typeof OrderStatusResponse>;
      try {
        status = await call(`/orders/status/${encodeURIComponent(orderId)}`, OrderStatusResponse);
      } catch (error) {
        // Right after landing there's no history yet.
        if (error instanceof VenueRejection && error.code === "not_found") return { state: "submitted", final: false, fills: [] };
        throw error;
      }
      const raw = status.status.toLowerCase();
      const state = STATES[raw] ?? "unknown";
      const closed = status.latestEventType === "order_closed";
      const final = state === "filled" || state === "failed" || closed;
      const fills = state === "submitted" || state === "open" ? [] : await fillsFor(orderId, owner);
      return {
        state: closed && state !== "filled" && fills.length ? "partial" : state,
        final,
        fills,
        reason: state === "failed" ? "Jupiter couldn't fill the order. Your USDC was returned." : undefined,
      };
    },

    async positions(owner) {
      const out: WalletPosition[] = [];
      for (let start = 0; ; start += POSITIONS_PAGE) {
        const query = new URLSearchParams({ ownerPubkey: owner, start: String(start), end: String(start + POSITIONS_PAGE) });
        const page = await call(`/positions?${query}`, PositionsPage);
        for (const raw of page.data) {
          const parsed = Position.safeParse(raw);
          if (parsed.success) out.push(positionOf(parsed.data));
          else log.warn("unparseable position skipped", { issues: parsed.error.issues.slice(0, 3) });
        }
        if (!page.pagination?.hasNext || page.data.length === 0) return out;
      }
    },

    async buildClaim(positionId, owner): Promise<ClaimTicket> {
      const built = await call(`/positions/${encodeURIComponent(positionId)}/claim`, ClaimResponse, {
        method: "POST",
        body: { ownerPubkey: owner },
      });
      return {
        tx: unsigned(built.transaction, built.txMeta, [owner]),
        positionId: built.position.positionPubkey,
        payout: built.position.payoutAmountUsd ?? 0,
      };
    },
  };
}

export const jupiterExecution: ExecutionModule = {
  id: "jupiter-execution",
  venues: [jupiter.id],
  collateral: { chain: "solana", mint: USDC_MINT, decimals: 6, symbol: "USDC" },
  create: (ctx) => createJupiterExecution(ctx),
};
