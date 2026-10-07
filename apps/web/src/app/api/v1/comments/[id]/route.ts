import { route } from "@imo/server/http/route";
import { IdParams } from "@imo/server/http/post-schemas";
import { deleteComment } from "@imo/server/usecases/posts";

export const DELETE = route({
  auth: "required",
  limit: "api:write",
  params: IdParams,
  handler: ({ deps, viewer, params }) => deleteComment(deps.db, viewer, params.id, deps.clock.now()),
});
