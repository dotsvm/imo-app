import { route } from "@imo/server/http/route";
import { HandleParams } from "@imo/server/http/people-schemas";
import { getTrader } from "@imo/server/usecases/people";

export const GET = route({
  auth: "optional",
  limit: "api:read",
  params: HandleParams,
  handler: ({ deps, viewer, params }) => getTrader(deps.db, viewer, params.handle),
});
