import { route } from "@imo/server/http/route";
import { RoomParams } from "@imo/server/http/room-schemas";
import { requestToJoin } from "@imo/server/usecases/rooms";

/** Ask to join an invite-only room. */
export const POST = route({
  auth: "required",
  limit: "api:write",
  params: RoomParams,
  handler: ({ deps, viewer, params }) => requestToJoin(deps, deps.db, viewer, params.slug),
});
