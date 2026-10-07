import { z } from "zod";
import { route } from "@imo/server/http/route";
import { RoomParams } from "@imo/server/http/room-schemas";
import { createChannel } from "@imo/server/usecases/rooms";

export const POST = route({
  auth: "required",
  limit: "api:write",
  status: 201,
  params: RoomParams,
  body: z.object({
    name: z.string().trim().min(2).max(40),
    topic: z.string().trim().max(160).default(""),
    market: z.string().min(1).max(120).optional(),
  }),
  handler: ({ deps, viewer, params, body }) => createChannel(deps, deps.db, viewer, params.slug, body),
});
