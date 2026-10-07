import { z } from "zod";
import { route } from "@imo/server/http/route";
import { PASS_EDITIONS } from "@imo/core/waitlist";
import { claimHandle } from "@imo/server/usecases/waitlist";

const handle = z.string().trim().min(1).max(40).transform((h) => h.replace(/^@/, ""));

/** Make a handle yours and hold your place in line (signed in, gate or not):
    with the pass edition you picked, and whose link sent you, if anyone's. */
export const POST = route({
  auth: "required",
  gate: false,
  limit: "api:auth",
  body: z.object({ handle, edition: z.enum(PASS_EDITIONS).optional(), ref: handle.optional() }),
  handler: ({ deps, viewer, body }) =>
    claimHandle(deps, deps.db, viewer, body.handle, { edition: body.edition, ref: body.ref }),
});
