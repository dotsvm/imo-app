import { route } from "@imo/server/http/route";
import { SignedBody } from "@imo/server/http/trading-schemas";
import { submitSkrSwap } from "@imo/server/usecases/skr";

/** Relay the signed swap: only the one /wallet/skr/swap built. */
export const POST = route({
  auth: "required",
  limit: "api:order",
  body: SignedBody,
  handler: ({ deps, viewer, body }) => submitSkrSwap(deps, viewer, body.signedTransaction),
});
