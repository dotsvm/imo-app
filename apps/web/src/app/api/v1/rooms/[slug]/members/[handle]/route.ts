import { z } from "zod";
import { route } from "@imo/server/http/route";
import { RoomHandleParams } from "@imo/server/http/room-schemas";
import { removeMember, setRole } from "@imo/server/usecases/rooms";

export const PATCH = route({
  auth: "required",
  limit: "api:write",
  params: RoomHandleParams,
  body: z.object({ role: z.enum(["Moderator", "Member"]) }),
  handler: ({ deps, viewer, params, body }) => setRole(deps, deps.db, viewer, params.slug, params.handle, body.role),
});

export const DELETE = route({
  auth: "required",
  limit: "api:write",
  params: RoomHandleParams,
  handler: ({ deps, viewer, params }) => removeMember(deps, deps.db, viewer, params.slug, params.handle),
});
