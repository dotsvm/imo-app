import { z } from "zod";
import { route } from "@imo/server/http/route";
import { PlaceBody } from "@imo/server/http/trading-schemas";
import { listOrders } from "@imo/server/usecases/trading";
import { placeOrBuild } from "@imo/server/usecases/wallet-trading";

export const GET = route({
  auth: "required",
  limit: "api:read",
  query: z.object({ status: z.enum(["resting", "all"]).default("all") }),
  handler: ({ deps, viewer, query }) => listOrders(deps.db, viewer, query.status),
});

/**
 * Idempotent by clientOrderId: a retry returns the first result. With wallet
 * trading this builds the order: the response carries the transaction for the
 * trader's wallet to sign and send back to /orders/{id}/submit.
 */
export const POST = route({
  auth: "required",
  limit: "api:order",
  status: 201,
  body: PlaceBody,
  handler: ({ deps, viewer, body }) => placeOrBuild(deps, deps.db, viewer, body),
});
