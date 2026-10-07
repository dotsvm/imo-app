import { admin, Handle, PersonChange } from "@imo/server/http/admin-schemas";
import { route } from "@imo/server/http/route";
import { updatePerson } from "@imo/server/usecases/admin";

/** Let someone in (or not), suspend them, or change their role. */
export const PATCH = route({
  ...admin,
  limit: "api:write",
  params: Handle,
  body: PersonChange,
  handler: ({ deps, viewer, params, body }) => updatePerson(deps, deps.db, viewer, params.handle, body),
});
