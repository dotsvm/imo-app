import { z } from "zod";
import { route } from "@imo/server/http/route";
import { SignedBody } from "@imo/server/http/trading-schemas";
import { submitWalletClaim } from "@imo/server/usecases/wallet-trading";

/** Land a signed claim and book the payout. */
export const POST = route({
  auth: "required",
  limit: "api:write",
  params: z.object({ id: z.string().regex(/^[a-z0-9-]+:(yes|no)$/) }),
  body: SignedBody,
  handler: ({ deps, viewer, params, body }) => submitWalletClaim(deps, deps.db, viewer, params.id, body.signedTransaction),
});
