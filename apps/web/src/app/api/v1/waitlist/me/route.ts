import { route } from "@imo/server/http/route";
import { waitlistStatus } from "@imo/server/usecases/waitlist";

/** Your handle and your place in line; null when you're not signed in. */
export const GET = route({
  auth: "optional",
  gate: false,
  limit: "api:read",
  handler: async ({ deps, viewer }) => (viewer ? waitlistStatus(deps.db, viewer) : null),
});
