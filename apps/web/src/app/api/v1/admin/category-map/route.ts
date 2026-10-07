import { admin, MappingBody } from "@imo/server/http/admin-schemas";
import { route } from "@imo/server/http/route";
import { categoryMap, setCategoryMapping } from "@imo/server/usecases/admin";

export const GET = route({ ...admin, limit: "api:read", handler: ({ deps }) => categoryMap(deps.db) });

export const PUT = route({
  ...admin,
  limit: "api:write",
  body: MappingBody,
  handler: ({ deps, viewer, body }) => setCategoryMapping(deps.db, viewer, body),
});
