import { z } from "zod";
import { route } from "@imo/server/http/route";
import { RoomParams } from "@imo/server/http/room-schemas";
import { setRoomNotify } from "@imo/server/usecases/rooms";

export const PUT = route({
  auth: "required",
  limit: "api:write",
  params: RoomParams,
  body: z.object({ notify: z.enum(["All messages", "Mentions", "Nothing"]) }),
  handler: ({ deps, viewer, params, body }) => setRoomNotify(deps, deps.db, viewer, params.slug, body.notify),
});
