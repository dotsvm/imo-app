import { z } from "zod";
import { admin } from "@imo/server/http/admin-schemas";
import { route } from "@imo/server/http/route";
import { moderationQueue } from "@imo/server/usecases/reports";

export const GET = route({
  ...admin,
  limit: "api:read",
  query: z.object({ status: z.enum(["open", "actioned", "dismissed"]).default("open") }),
  handler: ({ deps, query }) => moderationQueue(deps.db, query.status),
});
