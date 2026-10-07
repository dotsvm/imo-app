import { z } from "zod";
import { route } from "@imo/server/http/route";
import { redeemInvite } from "@imo/server/usecases/beta";

export const POST = route({
  auth: "required",
  gate: false,
  limit: "api:auth",
  body: z.object({ code: z.string().trim().min(8).max(20) }),
  handler: ({ deps, viewer, body }) => redeemInvite(deps, deps.db, viewer, body.code),
});
