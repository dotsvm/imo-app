import { route } from "@imo/server/http/route";
import { shareWaitlist } from "@imo/server/usecases/waitlist";

/** You shared your pass: you move up the line, once. */
export const POST = route({
  auth: "required",
  gate: false,
  limit: "api:auth",
  handler: ({ deps, viewer }) => shareWaitlist(deps, deps.db, viewer),
});
