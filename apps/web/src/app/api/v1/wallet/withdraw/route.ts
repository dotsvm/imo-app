import { z } from "zod";
import { route } from "@imo/server/http/route";
import { buildWithdrawal } from "@imo/server/usecases/withdraw";

/** A USDC transfer out of the trader's wallet, built for it to sign. */
export const POST = route({
  auth: "required",
  limit: "api:order",
  body: z.object({
    to: z.string().min(32).max(44),
    amountCents: z.number().positive().max(100_000_000),
  }),
  handler: ({ deps, viewer, body }) => buildWithdrawal(deps, deps.db, viewer, body),
});
