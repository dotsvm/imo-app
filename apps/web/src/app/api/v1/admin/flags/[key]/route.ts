import { z } from "zod";
import { admin, FlagBody } from "@imo/server/http/admin-schemas";
import { route } from "@imo/server/http/route";
import { setFlag } from "@imo/server/usecases/admin";

export const PUT = route({
  ...admin,
  limit: "api:write",
  params: z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/) }),
  body: FlagBody,
  handler: ({ deps, viewer, params, body }) => setFlag(deps, deps.db, viewer, params.key, body),
});
