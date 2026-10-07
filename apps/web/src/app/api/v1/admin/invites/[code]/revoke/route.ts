import { z } from "zod";
import { admin } from "@imo/server/http/admin-schemas";
import { route } from "@imo/server/http/route";
import { revokeInvite } from "@imo/server/usecases/admin";

export const POST = route({
  ...admin,
  limit: "api:write",
  params: z.object({ code: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/) }),
  handler: ({ deps, viewer, params }) => revokeInvite(deps, deps.db, viewer, params.code),
});
