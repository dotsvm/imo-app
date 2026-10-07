import { route } from "@imo/server/http/route";
import { portfolioFor } from "@imo/server/usecases/wallet-trading";

export const GET = route({
  auth: "required",
  limit: "api:read",
  handler: ({ deps, viewer }) => portfolioFor(deps, deps.db, viewer),
});
