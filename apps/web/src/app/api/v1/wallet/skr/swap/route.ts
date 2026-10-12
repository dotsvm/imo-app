import { z } from "zod";
import { route } from "@imo/server/http/route";
import { buildSkrSwap } from "@imo/server/usecases/skr";

/** A swap of SKR to USDC through Jupiter, built for the trader's wallet to sign. */
export const POST = route({
  auth: "required",
  limit: "api:order",
  body: z.object({ skr: z.number().positive().max(1_000_000_000) }),
  handler: ({ deps, viewer, body }) => buildSkrSwap(deps, deps.db, viewer, body),
});
