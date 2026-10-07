import { z } from "zod";
import { route } from "@imo/server/http/route";
import { marketHolders } from "@imo/server/usecases/markets";

/** Who holds this market on Hunch, biggest first (private positions stay out). */
export const GET = route({
  auth: "optional",
  limit: "api:read",
  params: z.object({ slug: z.string().min(1).max(120) }),
  query: z.object({ limit: z.coerce.number().int().min(1).max(50).optional() }),
  handler: ({ deps, viewer, params, query }) => marketHolders(deps.db, viewer, params.slug, query.limit),
});
