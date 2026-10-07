import { z } from "zod";
import { CATEGORIES } from "@imo/server/db/schema";
import { route } from "@imo/server/http/route";
import { listTraders } from "@imo/server/usecases/people";

export const GET = route({
  auth: "optional",
  limit: "api:read",
  query: z.object({
    q: z.string().trim().max(60).optional(),
    category: z.enum(CATEGORIES).optional(),
    suggested: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }),
  handler: ({ deps, viewer, query }) => listTraders(deps.db, viewer, query),
});
