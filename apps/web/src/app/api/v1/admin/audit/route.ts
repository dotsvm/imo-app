import { z } from "zod";
import { admin } from "@imo/server/http/admin-schemas";
import { route } from "@imo/server/http/route";
import { auditTrail } from "@imo/server/usecases/admin";

export const GET = route({
  ...admin,
  limit: "api:read",
  query: z.object({ subject: z.string().max(120).optional(), limit: z.coerce.number().int().min(1).max(500).optional() }),
  handler: ({ deps, query }) => auditTrail(deps.db, query),
});
