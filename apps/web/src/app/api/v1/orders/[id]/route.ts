import { z } from "zod";
import { route } from "@imo/server/http/route";
import { getOrder } from "@imo/server/usecases/wallet-trading";

/** One order. A wallet order in flight is checked with the venue first. */
export const GET = route({
  auth: "required",
  limit: "api:read",
  params: z.object({ id: z.uuid() }),
  handler: ({ deps, viewer, params }) => getOrder(deps, deps.db, viewer, params.id),
});
