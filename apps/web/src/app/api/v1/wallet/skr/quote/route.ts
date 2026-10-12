import { z } from "zod";
import { route } from "@imo/server/http/route";
import { quoteSkrSwap } from "@imo/server/usecases/skr";

/** What an amount of SKR would swap to in USDC right now. Nothing is built. */
export const GET = route({
  auth: "required",
  limit: "api:read",
  query: z.object({ skr: z.coerce.number().positive().max(1_000_000_000) }),
  handler: ({ deps, query }) => quoteSkrSwap(deps, query),
});
