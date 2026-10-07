import { z } from "zod";
import { route } from "@imo/server/http/route";
import { resetAccount } from "@imo/server/usecases/portfolio";

/** The typed confirmation is part of the contract, not just the UI. */
export const POST = route({
  auth: "required",
  limit: "api:write",
  body: z.object({ confirm: z.literal("RESET") }),
  handler: ({ deps, viewer }) => resetAccount(deps.db, viewer, deps.clock.now()),
});
