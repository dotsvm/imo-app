import { route } from "@imo/server/http/route";
import { RoomParams } from "@imo/server/http/room-schemas";
import { joinRoom, leaveRoom } from "@imo/server/usecases/rooms";

export const PUT = route({
  auth: "required",
  limit: "api:write",
  params: RoomParams,
  handler: ({ deps, viewer, params }) => joinRoom(deps, deps.db, viewer, params.slug),
});

export const DELETE = route({
  auth: "required",
  limit: "api:write",
  params: RoomParams,
  handler: ({ deps, viewer, params }) => leaveRoom(deps, deps.db, viewer, params.slug),
});
