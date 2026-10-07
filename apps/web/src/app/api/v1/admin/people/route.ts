import { z } from "zod";
import { admin } from "@imo/server/http/admin-schemas";
import { route } from "@imo/server/http/route";
import { findPeople } from "@imo/server/usecases/admin";

export const GET = route({
  ...admin,
  limit: "api:read",
  query: z.object({ q: z.string().trim().max(100).optional() }),
  handler: ({ deps, viewer, query }) => findPeople(deps.db, viewer, query.q),
});
