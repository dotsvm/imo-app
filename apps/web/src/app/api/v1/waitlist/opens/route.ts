import { z } from "zod";
import { route } from "@imo/server/http/route";
import { recordLinkOpen } from "@imo/server/usecases/waitlist";

/** Someone opened a holder's link (once per browser, the page decides). */
export const POST = route({
  auth: "none",
  gate: false,
  limit: "api:auth",
  status: 202,
  body: z.object({ handle: z.string().trim().min(1).max(40) }),
  handler: ({ deps, body }) => recordLinkOpen(deps.db, body.handle.replace(/^@/, "")),
});
