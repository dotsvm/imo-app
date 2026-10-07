import { z } from "zod";
import { route } from "@imo/server/http/route";
import { deleteWatchlist, renameWatchlist } from "@imo/server/usecases/watchlists";

const Params = z.object({ id: z.union([z.literal("saved"), z.uuid()]) });

export const PATCH = route({
  auth: "required",
  limit: "api:write",
  params: Params,
  body: z.object({ name: z.string().trim().min(1).max(40) }),
  handler: ({ deps, viewer, params, body }) => renameWatchlist(deps.db, viewer, params.id, body.name),
});

export const DELETE = route({
  auth: "required",
  limit: "api:write",
  params: Params,
  handler: ({ deps, viewer, params }) => deleteWatchlist(deps.db, viewer, params.id),
});
