import { route } from "@imo/server/http/route";
import { ChannelParams } from "@imo/server/http/room-schemas";
import { markChannelRead } from "@imo/server/usecases/rooms";

export const POST = route({
  auth: "required",
  limit: "api:write",
  params: ChannelParams,
  handler: ({ deps, viewer, params }) => markChannelRead(deps, deps.db, viewer, params.slug, params.channel),
});
