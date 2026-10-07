import { route } from "@imo/server/http/route";
import { RoomParams, RoomPatch } from "@imo/server/http/room-schemas";
import { getRoom, updateRoom } from "@imo/server/usecases/rooms";

export const GET = route({
  auth: "optional",
  limit: "api:read",
  params: RoomParams,
  handler: ({ deps, viewer, params }) => getRoom(deps, deps.db, viewer, params.slug),
});

export const PATCH = route({
  auth: "required",
  limit: "api:write",
  params: RoomParams,
  body: RoomPatch,
  handler: ({ deps, viewer, params, body }) => updateRoom(deps, deps.db, viewer, params.slug, body),
});
