/**
 * Real-money orders, end to end: the API builds the venue's transaction, the
 * wallet signs it on this device, the API lands it, and we follow it until
 * it fills (or doesn't). Each step reports so the sheet can say what's
 * happening — signing, sending, filling — instead of a bare spinner.
 */
import type { OrderDTO, WalletClaimDTO, WalletClaimReceiptDTO, WalletOrderDTO } from "@imo/server/dto/api-types";
import { api } from "~/lib/api";

export type OrderStep = "building" | "signing" | "sending" | "filling";

export interface WalletOrderBody {
  market: string;
  side: "Buy" | "Sell";
  outcome: "Yes" | "No";
  amountCents?: number;
  shares?: number;
  postId?: string;
  clientOrderId: string;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Keepers usually fill within seconds; give up following after ~a minute
    (the order keeps going server-side and shows in the portfolio). */
const FOLLOW_FOR_MS = 60_000;

export async function placeWalletOrder(
  body: WalletOrderBody,
  sign: (transaction: string) => Promise<string>,
  onStep: (step: OrderStep) => void,
): Promise<OrderDTO> {
  onStep("building");
  const built = await api<WalletOrderDTO>("/orders", { body: { ...body, type: "market" } });
  let order = built.order;
  if (order.status === "pending" && built.transaction) {
    onStep("signing");
    const signed = await sign(built.transaction);
    onStep("sending");
    order = (await api<WalletOrderDTO>(`/orders/${order.id}/submit`, { body: { signedTransaction: signed } })).order;
  }
  onStep("filling");
  const until = Date.now() + FOLLOW_FOR_MS;
  while (order.status === "pending" && Date.now() < until) {
    await pause(1_500);
    order = await api<OrderDTO>(`/orders/${order.id}`);
  }
  return order;
}

export async function claimWithWallet(
  positionId: string,
  sign: (transaction: string) => Promise<string>,
  onStep: (step: OrderStep) => void,
): Promise<WalletClaimReceiptDTO> {
  onStep("building");
  const built = await api<WalletClaimDTO>(`/positions/${positionId}/claim`, { method: "POST" });
  onStep("signing");
  const signed = await sign(built.transaction);
  onStep("sending");
  return api<WalletClaimReceiptDTO>(`/positions/${positionId}/claim/submit`, { body: { signedTransaction: signed } });
}

export const STEP_LABEL: Record<OrderStep, string> = {
  building: "Getting the transaction from Jupiter…",
  signing: "Signing with your wallet…",
  sending: "Sending to Solana…",
  filling: "Filling at Jupiter…",
};
