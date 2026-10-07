import { z } from "zod";
import { route } from "@imo/server/http/route";
import { listMarkets, MARKET_SORTS } from "@imo/server/usecases/markets";

const Query = z.object({
  category: z.string().max(40).optional(),
  venue: z.string().max(40).optional(),
  status: z.enum(["open", "soon", "closed", "resolved", "all"]).optional(),
  sort: z.enum(MARKET_SORTS).optional(),
  q: z.string().max(120).optional(),
  ids: z
    .string()
    .max(4000)
    .transform((v) => v.split(",").filter(Boolean).slice(0, 100))
    .optional(),
  featured: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  min: z.coerce.number().min(0).max(100).optional(),
  max: z.coerce.number().min(0).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(64).optional(),
});

export const GET = route({
  auth: "optional",
  gate: false,
  limit: "api:read",
  query: Query,
  handler: ({ deps, query }) =>
    listMarkets(
      deps.db,
      { ...query, minCents: query.min, maxCents: query.max },
      deps.clock.now(),
    ),
});
