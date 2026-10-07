import { z } from "zod";
import { route } from "@imo/server/http/route";
import { marketTrades } from "@imo/server/usecases/markets";

export const GET = route({
  auth: "optional",
  gate: false,
  limit: "api:read",
  params: z.object({ slug: z.string().min(1).max(120) }),
  handler: ({ deps, params }) => marketTrades(deps, deps.db, params.slug),
});
