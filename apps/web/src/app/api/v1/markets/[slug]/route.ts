import { z } from "zod";
import { route } from "@imo/server/http/route";
import { touchInterest } from "@imo/server/usecases/books";
import { getMarket } from "@imo/server/usecases/markets";

export const GET = route({
  auth: "optional",
  gate: false,
  limit: "api:read",
  params: z.object({ slug: z.string().min(1).max(120) }),
  handler: async ({ deps, params }) => {
    const market = await getMarket(deps.db, params.slug);
    // Someone is looking: keep this market's book and price live.
    await touchInterest(deps.db, params.slug, deps.clock.now());
    return market;
  },
});
