/** Request bodies shared by the quote and order endpoints. */
import { z } from "zod";

export const OrderBody = z
  .object({
    market: z.string().min(1).max(120),
    side: z.enum(["Buy", "Sell"]),
    outcome: z.enum(["Yes", "No"]),
    type: z.enum(["market", "limit"]).default("market"),
    amountCents: z.number().int().positive().max(1_000_000_000).optional(),
    /** Whole shares for paper; wallet venues trade hundredths. */
    shares: z.number().positive().max(100_000_000).optional(),
    limitCents: z.number().positive().max(99.99).optional(),
    expectedPriceCents: z.number().positive().max(100).optional(),
    postId: z.uuid().optional(),
  })
  .refine((o) => (o.side === "Buy" ? o.amountCents !== undefined || o.shares !== undefined : o.shares !== undefined), {
    message: "Buys need an amount or shares; sells need shares.",
  });

export const PlaceBody = OrderBody.and(
  z.object({ clientOrderId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/) }),
);

/** A transaction the trader's wallet signed: base64 wire bytes. */
export const SignedBody = z.object({
  signedTransaction: z.string().min(100).max(4_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
