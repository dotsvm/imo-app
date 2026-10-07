import { route } from "@imo/server/http/route";
import { createMyInvite, myInvites } from "@imo/server/usecases/beta";

export const GET = route({
  auth: "required",
  limit: "api:read",
  handler: ({ deps, viewer }) => myInvites(deps.db, viewer),
});

/** A single-use invite to pass on. */
export const POST = route({
  auth: "required",
  limit: "api:write",
  status: 201,
  handler: ({ deps, viewer }) => createMyInvite(deps, deps.db, viewer),
});
