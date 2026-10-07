import { z } from "zod";
import { route } from "@imo/server/http/route";
import { RoomDraft } from "@imo/server/http/room-schemas";
import { createRoom, listRooms } from "@imo/server/usecases/rooms";

export const GET = route({
  auth: "optional",
  limit: "api:read",
  query: z.object({
    mine: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
    q: z.string().trim().max(60).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
  handler: ({ deps, viewer, query }) => listRooms(deps, deps.db, viewer, query),
});

export const POST = route({
  auth: "required",
  limit: "api:write",
  status: 201,
  body: RoomDraft,
  handler: ({ deps, viewer, body }) => createRoom(deps, deps.db, viewer, body),
});
