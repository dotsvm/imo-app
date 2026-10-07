import { z } from "zod";
import { route } from "@imo/server/http/route";
import { markNotificationsRead } from "@imo/server/usecases/notifications";

export const POST = route({
  auth: "required",
  limit: "api:write",
  body: z.union([
    z.object({ ids: z.array(z.uuid()).min(1).max(100) }),
    z.object({ all: z.literal(true) }),
  ]),
  handler: ({ deps, viewer, body }) =>
    markNotificationsRead(deps.db, viewer, body, deps.clock.now()),
});
