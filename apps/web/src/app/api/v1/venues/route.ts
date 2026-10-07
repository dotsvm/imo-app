import { route } from "@imo/server/http/route";
import { listVenues } from "@imo/server/usecases/venues";

export const GET = route({
  auth: "optional",
  gate: false,
  limit: "api:read",
  handler: ({ deps }) => listVenues(deps.db),
});
