import { z } from "zod";
import { route } from "@imo/server/http/route";
import { placeMarket, removeMarket } from "@imo/server/usecases/watchlists";

const Params = z.object({ id: z.union([z.literal("saved"), z.uuid()]), slug: z.string().min(1).max(120) });

/** Add the market, or move it to `index`; the end when no index is given. */
export const PUT = route({
  auth: "required",
  limit: "api:write",
  params: Params,
  body: z.object({ index: z.number().int().min(0).max(10_000).optional() }).default({}),
  handler: ({ deps, viewer, params, body }) => placeMarket(deps.db, viewer, params.id, params.slug, body.index),
});

export const DELETE = route({
  auth: "required",
  limit: "api:write",
  params: Params,
  handler: ({ deps, viewer, params }) => removeMarket(deps.db, viewer, params.id, params.slug),
});
