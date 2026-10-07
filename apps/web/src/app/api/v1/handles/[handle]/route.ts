import { z } from "zod";
import { route } from "@imo/server/http/route";
import { handleAvailability } from "@imo/server/usecases/waitlist";

/** Is this handle free? Answers for anyone, so the waitlist page can check as you type. */
export const GET = route({
  auth: "optional",
  gate: false,
  limit: "api:read",
  params: z.object({ handle: z.string().min(1).max(40) }),
  handler: ({ deps, viewer, params }) => handleAvailability(deps.db, viewer, params.handle.replace(/^@/, "")),
});
