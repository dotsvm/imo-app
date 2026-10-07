import { route } from "@imo/server/http/route";
import { FeedQuery, PostBody } from "@imo/server/http/post-schemas";
import { createPost, listPosts } from "@imo/server/usecases/posts";

export const GET = route({
  auth: "optional",
  limit: "api:read",
  query: FeedQuery,
  handler: ({ deps, viewer, query }) => listPosts(deps, deps.db, viewer, query),
});

export const POST = route({
  auth: "required",
  limit: "api:write",
  status: 201,
  body: PostBody,
  handler: ({ deps, viewer, body }) => createPost(deps, deps.db, viewer, body),
});
