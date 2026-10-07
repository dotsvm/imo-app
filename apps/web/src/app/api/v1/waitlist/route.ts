import { z } from "zod";
import { route } from "@imo/server/http/route";
import { joinWaitlist } from "@imo/server/usecases/beta";
import { waitlistSize } from "@imo/server/usecases/waitlist";

/** How many people are waiting. */
export const GET = route({
  auth: "none",
  gate: false,
  limit: "api:read",
  handler: ({ deps }) => waitlistSize(deps.db),
});

export const POST = route({
  auth: "none",
  gate: false,
  limit: "api:auth",
  status: 202,
  body: z.object({ email: z.email().max(254), note: z.string().trim().max(500).optional() }),
  handler: ({ deps, body }) => joinWaitlist(deps, deps.db, body.email, body.note),
});
