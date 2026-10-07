import { z } from "zod";
import { CATEGORIES } from "@imo/server/db/schema";
import { route } from "@imo/server/http/route";
import { LEADERBOARD_SORTS, PERIODS, leaderboard } from "@imo/server/usecases/stats";

export const GET = route({
  auth: "optional",
  limit: "api:read",
  query: z.object({
    period: z.enum(Object.keys(PERIODS) as [keyof typeof PERIODS, ...(keyof typeof PERIODS)[]]).optional(),
    sort: z.enum(LEADERBOARD_SORTS).optional(),
    category: z.enum(CATEGORIES).optional(),
    sample: z.enum(["on", "off"]).transform((v) => v === "on").optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().max(40).optional(),
  }),
  handler: ({ deps, viewer, query }) => leaderboard(deps.db, viewer, query),
});
