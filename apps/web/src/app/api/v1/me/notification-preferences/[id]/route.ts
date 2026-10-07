import { z } from "zod";
import { route } from "@imo/server/http/route";
import { setNotificationPreference } from "@imo/server/usecases/people";

export const PATCH = route({
  auth: "required",
  limit: "api:write",
  params: z.object({ id: z.string().regex(/^[a-z-]{2,40}$/) }),
  body: z.object({ app: z.boolean().optional(), email: z.boolean().optional() }).strict(),
  handler: ({ deps, viewer, params, body }) => setNotificationPreference(deps.db, viewer, params.id, body),
});
