import { z } from "zod";
import { route } from "@imo/server/http/route";
import { RoomParams } from "@imo/server/http/room-schemas";
import { addRoomMarkets, removeRoomMarket } from "@imo/server/usecases/rooms";

const Params = RoomParams.extend({ market: z.string().min(1).max(120) });

export const PUT = route({
  auth: "required",
  limit: "api:write",
  params: Params,
  handler: async ({ deps, viewer, params }) =>
    (await addRoomMarkets(deps, deps.db, viewer, params.slug, [params.market])).room,
});

export const DELETE = route({
  auth: "required",
  limit: "api:write",
  params: Params,
  handler: ({ deps, viewer, params }) => removeRoomMarket(deps, deps.db, viewer, params.slug, params.market),
});
