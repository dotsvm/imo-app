import { route } from "@imo/server/http/route";
import { HandleParams } from "@imo/server/http/people-schemas";
import { follow, unfollow } from "@imo/server/usecases/people";

export const PUT = route({
  auth: "required",
  limit: "api:write",
  params: HandleParams,
  handler: ({ deps, viewer, params }) => follow(deps.db, viewer, params.handle),
});

export const DELETE = route({
  auth: "required",
  limit: "api:write",
  params: HandleParams,
  handler: ({ deps, viewer, params }) => unfollow(deps.db, viewer, params.handle),
});
