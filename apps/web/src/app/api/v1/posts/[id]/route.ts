import { route } from "@imo/server/http/route";
import { IdParams, PostPatch } from "@imo/server/http/post-schemas";
import { deletePost, editPost, getPost } from "@imo/server/usecases/posts";

export const GET = route({
  auth: "optional",
  limit: "api:read",
  params: IdParams,
  handler: ({ deps, viewer, params }) => getPost(deps, deps.db, viewer, params.id),
});

/** Within five minutes of posting. */
export const PATCH = route({
  auth: "required",
  limit: "api:write",
  params: IdParams,
  body: PostPatch,
  handler: ({ deps, viewer, params, body }) => editPost(deps, deps.db, viewer, params.id, body),
});

export const DELETE = route({
  auth: "required",
  limit: "api:write",
  params: IdParams,
  handler: ({ deps, viewer, params }) => deletePost(deps, deps.db, viewer, params.id),
});
