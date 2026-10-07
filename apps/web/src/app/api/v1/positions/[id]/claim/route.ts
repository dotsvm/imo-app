import { z } from "zod";
import { route } from "@imo/server/http/route";
import { claimOrBuild } from "@imo/server/usecases/wallet-trading";

/** Paper pays out at once; with a wallet this builds the claim to sign and
    send back to ./submit. */
export const POST = route({
  auth: "required",
  limit: "api:write",
  params: z.object({ id: z.string().regex(/^[a-z0-9-]+:(yes|no)$/) }),
  handler: ({ deps, viewer, params }) => claimOrBuild(deps, deps.db, viewer, params.id),
});
