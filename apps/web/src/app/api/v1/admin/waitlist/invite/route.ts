import { z } from "zod";
import { admin } from "@imo/server/http/admin-schemas";
import { route } from "@imo/server/http/route";
import { inviteFromWaitlist } from "@imo/server/usecases/admin";

/** Mail a single-use invite to each address on the waitlist. */
export const POST = route({
  ...admin,
  limit: "api:write",
  body: z.object({ emails: z.array(z.email()).min(1).max(200) }),
  handler: ({ deps, viewer, body }) => inviteFromWaitlist(deps, deps.db, viewer, body.emails),
});
