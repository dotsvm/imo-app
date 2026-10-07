import { z } from "zod";
import { route } from "@imo/server/http/route";
import { RoomParams } from "@imo/server/http/room-schemas";
import { deleteMessage, editMessage } from "@imo/server/usecases/rooms";

const Params = RoomParams.extend({ id: z.uuid() });

export const PATCH = route({
  auth: "required",
  limit: "api:write",
  params: Params,
  body: z.object({ text: z.string().trim().min(1).max(4_000) }),
  handler: ({ deps, viewer, params, body }) => editMessage(deps, deps.db, viewer, params.slug, params.id, body.text),
});

export const DELETE = route({
  auth: "required",
  limit: "api:write",
  params: Params,
  handler: ({ deps, viewer, params }) => deleteMessage(deps, deps.db, viewer, params.slug, params.id),
});
