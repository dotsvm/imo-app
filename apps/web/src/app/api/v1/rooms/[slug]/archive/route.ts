import { route } from "@imo/server/http/route";
import { RoomParams } from "@imo/server/http/room-schemas";
import { archiveRoom } from "@imo/server/usecases/rooms";

export const POST = route({
  auth: "required",
  limit: "api:write",
  params: RoomParams,
  handler: ({ deps, viewer, params }) => archiveRoom(deps, deps.db, viewer, params.slug),
});
