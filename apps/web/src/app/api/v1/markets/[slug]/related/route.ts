import { z } from "zod";
import { route } from "@imo/server/http/route";
import { relatedMarkets } from "@imo/server/usecases/markets";

export const GET = route({
  auth: "optional",
  gate: false,
  limit: "api:read",
  params: z.object({ slug: z.string().min(1).max(120) }),
  handler: ({ deps, params }) =>
    relatedMarkets(deps.db, params.slug, deps.clock.now()),
});
