import { z } from "zod";
import { route } from "@imo/server/http/route";
import { changeEmail } from "@imo/server/usecases/people";

/** A new address for notification email; we mail it a confirmation link. */
export const POST = route({
  auth: "required",
  gate: false,
  limit: "api:auth",
  body: z.object({ email: z.email().max(254) }),
  handler: ({ deps, viewer, body }) => changeEmail(deps, deps.db, viewer, body.email.toLowerCase()),
});
