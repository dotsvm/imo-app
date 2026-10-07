import { z } from "zod";
import { admin } from "@imo/server/http/admin-schemas";
import { route } from "@imo/server/http/route";
import { retryJob } from "@imo/server/usecases/admin";

export const POST = route({
  ...admin,
  limit: "api:write",
  params: z.object({ id: z.uuid() }),
  handler: ({ deps, viewer, params }) => retryJob(deps, deps.db, viewer, params.id),
});
