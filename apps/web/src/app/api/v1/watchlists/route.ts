import { z } from "zod";
import { route } from "@imo/server/http/route";
import { createWatchlist, listWatchlists } from "@imo/server/usecases/watchlists";

export const GET = route({
  auth: "required",
  limit: "api:read",
  handler: ({ deps, viewer }) => listWatchlists(deps.db, viewer),
});

export const POST = route({
  auth: "required",
  limit: "api:write",
  status: 201,
  body: z.object({ name: z.string().trim().min(1).max(40), market: z.string().min(1).max(120).optional() }),
  handler: ({ deps, viewer, body }) => createWatchlist(deps.db, viewer, body.name, body.market),
});
