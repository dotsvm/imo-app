import { route } from "@imo/server/http/route";
import { IdParams } from "@imo/server/http/post-schemas";
import { SignedBody } from "@imo/server/http/trading-schemas";
import { submitTip } from "@imo/server/usecases/skr";

/** Relay the signed tip: only the one POST /posts/{id}/tips built. */
export const POST = route({
  auth: "required",
  limit: "api:order",
  params: IdParams,
  body: SignedBody,
  handler: ({ deps, viewer, params, body }) => submitTip(deps, deps.db, viewer, params.id, body.signedTransaction),
});
