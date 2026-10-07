import { z } from "zod";
import { route } from "@imo/server/http/route";
import { SignedBody } from "@imo/server/http/trading-schemas";
import { submitWalletOrder } from "@imo/server/usecases/wallet-trading";

/** Land a wallet order: the transaction /orders built, signed by the trader. */
export const POST = route({
  auth: "required",
  limit: "api:order",
  params: z.object({ id: z.uuid() }),
  body: SignedBody,
  handler: ({ deps, viewer, params, body }) => submitWalletOrder(deps, deps.db, viewer, params.id, body.signedTransaction),
});
