import { z } from "zod";
import { route } from "@imo/server/http/route";
import { search } from "@imo/server/usecases/search";

export const GET = route({
  auth: "optional",
  limit: "api:read",
  query: z.object({ q: z.string().max(100).default("") }),
  handler: ({ deps, viewer, query }) => search(deps, deps.db, viewer, query.q),
});
