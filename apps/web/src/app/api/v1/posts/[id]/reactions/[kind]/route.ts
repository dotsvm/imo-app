import { z } from "zod";
import { route } from "@imo/server/http/route";
import { reactToPost } from "@imo/server/usecases/posts";

const Params = z.object({ id: z.uuid(), kind: z.enum(["like", "bookmark", "repost"]) });

export const PUT = route({
  auth: "required",
  limit: "api:write",
  params: Params,
  handler: ({ deps, viewer, params }) => reactToPost(deps, deps.db, viewer, params.id, params.kind, true),
});

export const DELETE = route({
  auth: "required",
  limit: "api:write",
  params: Params,
  handler: ({ deps, viewer, params }) => reactToPost(deps, deps.db, viewer, params.id, params.kind, false),
});
