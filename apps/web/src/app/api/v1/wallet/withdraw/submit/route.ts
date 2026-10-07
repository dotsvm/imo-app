import { route } from "@imo/server/http/route";
import { SignedBody } from "@imo/server/http/trading-schemas";
import { submitWithdrawal } from "@imo/server/usecases/withdraw";

/** Relay the signed withdrawal: only the transfer /wallet/withdraw built. */
export const POST = route({
  auth: "required",
  limit: "api:order",
  body: SignedBody,
  handler: ({ deps, viewer, body }) => submitWithdrawal(deps, viewer, body.signedTransaction),
});
