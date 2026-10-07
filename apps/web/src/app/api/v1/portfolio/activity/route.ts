import { z } from "zod";
import { route } from "@imo/server/http/route";
import { getActivity } from "@imo/server/usecases/portfolio";

export const GET = route({
  auth: "required",
  limit: "api:read",
  query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }),
  handler: ({ deps, viewer, query }) => getActivity(deps.db, viewer, query.limit),
});
