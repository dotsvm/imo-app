import { z } from "zod";
import { route } from "@imo/server/http/route";
import { RoomHandleParams } from "@imo/server/http/room-schemas";
import { answerRequest } from "@imo/server/usecases/rooms";

export const POST = route({
  auth: "required",
  limit: "api:write",
  params: RoomHandleParams,
  body: z.object({ approve: z.boolean() }),
  handler: ({ deps, viewer, params, body }) => answerRequest(deps, deps.db, viewer, params.slug, params.handle, body.approve),
});
