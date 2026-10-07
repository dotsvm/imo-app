import { route } from "@imo/server/http/route";
import { IdParams } from "@imo/server/http/post-schemas";
import { likeComment } from "@imo/server/usecases/posts";

export const PUT = route({
  auth: "required",
  limit: "api:write",
  params: IdParams,
  handler: ({ deps, viewer, params }) => likeComment(deps.db, viewer, params.id, true),
});

export const DELETE = route({
  auth: "required",
  limit: "api:write",
  params: IdParams,
  handler: ({ deps, viewer, params }) => likeComment(deps.db, viewer, params.id, false),
});
