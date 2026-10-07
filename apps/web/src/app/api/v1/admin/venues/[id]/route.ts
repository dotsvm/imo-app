import { z } from "zod";
import { admin, VenueChange } from "@imo/server/http/admin-schemas";
import { route } from "@imo/server/http/route";
import { updateVenue } from "@imo/server/usecases/admin";

export const PATCH = route({
  ...admin,
  limit: "api:write",
  params: z.object({ id: z.string().regex(/^[a-z0-9-]{2,40}$/) }),
  body: VenueChange,
  handler: ({ deps, viewer, params, body }) => updateVenue(deps.db, viewer, params.id, body),
});
