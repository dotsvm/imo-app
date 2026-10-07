import { route } from "@imo/server/http/route";
import { HandleParams } from "@imo/server/http/people-schemas";
import { setBell } from "@imo/server/usecases/people";

/** Be told when this trader posts a prediction (follows them too). */
export const PUT = route({
  auth: "required",
  limit: "api:write",
  params: HandleParams,
  handler: ({ deps, viewer, params }) => setBell(deps.db, viewer, params.handle, true),
});

export const DELETE = route({
  auth: "required",
  limit: "api:write",
  params: HandleParams,
  handler: ({ deps, viewer, params }) => setBell(deps.db, viewer, params.handle, false),
});
