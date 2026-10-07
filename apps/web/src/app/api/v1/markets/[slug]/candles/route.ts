import { z } from "zod";
import { route } from "@imo/server/http/route";
import { marketCandles } from "@imo/server/usecases/markets";

export const GET = route({
  auth: "optional",
  gate: false,
  limit: "api:read",
  params: z.object({ slug: z.string().min(1).max(120) }),
  query: z.object({ range: z.enum(["1D", "1W", "1M", "All"]).default("1W") }),
  handler: ({ deps, params, query }) =>
    marketCandles(deps, deps.db, params.slug, query.range),
});
