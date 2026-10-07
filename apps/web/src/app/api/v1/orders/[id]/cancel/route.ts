import { z } from "zod";
import { route } from "@imo/server/http/route";
import { cancelOrder } from "@imo/server/usecases/trading";

export const POST = route({
  auth: "required",
  limit: "api:order",
  params: z.object({ id: z.uuid() }),
  handler: ({ deps, viewer, params }) => cancelOrder(deps, deps.db, viewer, params.id),
});
