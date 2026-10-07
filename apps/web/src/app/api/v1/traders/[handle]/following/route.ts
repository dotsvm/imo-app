import { z } from "zod";
import { route } from "@imo/server/http/route";
import { HandleParams } from "@imo/server/http/people-schemas";
import { listFollowingOf } from "@imo/server/usecases/people";

export const GET = route({
  auth: "optional",
  limit: "api:read",
  params: HandleParams,
  query: z.object({ before: z.iso.datetime().optional(), limit: z.coerce.number().int().min(1).max(100).optional() }),
  handler: ({ deps, viewer, params, query }) => listFollowingOf(deps.db, viewer, params.handle, query),
});
