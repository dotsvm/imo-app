import { z } from "zod";
import { route } from "@imo/server/http/route";
import { listNotifications } from "@imo/server/usecases/notifications";

export const GET = route({
  auth: "required",
  limit: "api:read",
  query: z.object({
    before: z.iso.datetime().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
  handler: ({ deps, viewer, query }) => listNotifications(deps.db, viewer, query),
});
