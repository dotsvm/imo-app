import { z } from "zod";
import { admin } from "@imo/server/http/admin-schemas";
import { route } from "@imo/server/http/route";
import { listWaitlist } from "@imo/server/usecases/admin";

export const GET = route({
  ...admin,
  limit: "api:read",
  query: z.object({ status: z.enum(["waiting", "invited", "all"]).default("waiting") }),
  handler: ({ deps, query }) => listWaitlist(deps.db, query.status),
});
