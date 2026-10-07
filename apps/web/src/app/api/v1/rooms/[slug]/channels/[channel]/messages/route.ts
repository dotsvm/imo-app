import { z } from "zod";
import { route } from "@imo/server/http/route";
import { ChannelParams, MessageBody } from "@imo/server/http/room-schemas";
import { listMessages, postMessage } from "@imo/server/usecases/rooms";

export const GET = route({
  auth: "optional",
  limit: "api:read",
  params: ChannelParams,
  query: z.object({
    before: z.iso.datetime().optional(),
    thread: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
  handler: ({ deps, viewer, params, query }) => listMessages(deps.db, viewer, params.slug, params.channel, query),
});

export const POST = route({
  auth: "required",
  limit: "api:write",
  status: 201,
  params: ChannelParams,
  body: MessageBody,
  handler: ({ deps, viewer, params, body }) =>
    postMessage(deps, deps.db, viewer, params.slug, { ...body, channel: params.channel }),
});
