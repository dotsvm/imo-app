import { z } from "zod";
import { admin } from "@imo/server/http/admin-schemas";
import { route } from "@imo/server/http/route";
import { listJobs } from "@imo/server/usecases/admin";

export const GET = route({
  ...admin,
  limit: "api:read",
  query: z.object({ status: z.enum(["pending", "running", "done", "dead"]).default("dead") }),
  handler: ({ deps, query }) => listJobs(deps.db, query.status),
});
