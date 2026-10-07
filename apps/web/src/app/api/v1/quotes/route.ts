import { route } from "@imo/server/http/route";
import { OrderBody } from "@imo/server/http/trading-schemas";
import { previewOrder } from "@imo/server/usecases/trading";

/** A preview on the live book: the ticket's numbers, before anything moves. */
export const POST = route({
  auth: "optional",
  // A read, posted: anyone may price a ticket, beta access or not.
  gate: false,
  limit: "api:read",
  body: OrderBody,
  handler: ({ deps, body }) => previewOrder(deps, deps.db, { ...body, clientOrderId: "preview" }),
});
