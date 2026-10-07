import { z } from "zod";
import { admin, MarketChange } from "@imo/server/http/admin-schemas";
import { route } from "@imo/server/http/route";
import { updateMarket } from "@imo/server/usecases/admin";

export const PATCH = route({
  ...admin,
  limit: "api:write",
  params: z.object({ slug: z.string().min(1).max(120) }),
  body: MarketChange,
  handler: ({ deps, viewer, params, body }) => updateMarket(deps.db, viewer, params.slug, body),
});
