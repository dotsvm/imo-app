import { route } from "@imo/server/http/route";
import { CommentBody, IdParams } from "@imo/server/http/post-schemas";
import { createComment, getPost, listComments } from "@imo/server/usecases/posts";

export const GET = route({
  auth: "optional",
  limit: "api:read",
  params: IdParams,
  handler: async ({ deps, viewer, params }) => {
    await getPost(deps, deps.db, viewer, params.id); // visible to you, or 404
    return listComments(deps.db, viewer, params.id);
  },
});

export const POST = route({
  auth: "required",
  limit: "api:write",
  status: 201,
  params: IdParams,
  body: CommentBody,
  handler: ({ deps, viewer, params, body }) => createComment(deps, deps.db, viewer, params.id, body),
});
