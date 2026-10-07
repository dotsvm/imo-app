import { route } from "@imo/server/http/route";
import { notificationPreferences } from "@imo/server/usecases/people";

export const GET = route({
  auth: "required",
  limit: "api:read",
  handler: ({ deps, viewer }) => notificationPreferences(deps.db, viewer),
});
