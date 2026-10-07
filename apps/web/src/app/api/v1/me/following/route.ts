import { route } from "@imo/server/http/route";
import { listFollowing } from "@imo/server/usecases/people";

export const GET = route({
  auth: "required",
  limit: "api:read",
  handler: ({ deps, viewer }) => listFollowing(deps.db, viewer),
});
