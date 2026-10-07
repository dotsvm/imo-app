import { z } from "zod";
import { route } from "@imo/server/http/route";
import { RoomParams } from "@imo/server/http/room-schemas";
import { addRoomMarkets } from "@imo/server/usecases/rooms";

/** Share markets to the room's list; answers with how many were new. */
export const POST = route({
  auth: "required",
  limit: "api:write",
  params: RoomParams,
  body: z.object({ markets: z.array(z.string().min(1).max(120)).min(1).max(20) }),
  handler: ({ deps, viewer, params, body }) => addRoomMarkets(deps, deps.db, viewer, params.slug, body.markets),
});
