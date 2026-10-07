import { z } from "zod";
import { ROOM_COLORS, type RoomColor } from "../catalogs";

export const RoomParams = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,60}$/) });
export const RoomHandleParams = RoomParams.extend({
  handle: z.string().regex(/^@?[A-Za-z0-9_]{2,24}$/).transform((h) => h.replace(/^@/, "")),
});
export const ChannelParams = RoomParams.extend({ channel: z.string().regex(/^[a-z0-9-]{1,60}$/) });

export const RoomDraft = z.object({
  name: z.string().trim().min(3).max(40),
  description: z.string().trim().max(280).default(""),
  privacy: z.enum(["Public", "Invite only"]),
  watchlist: z.array(z.string().min(1).max(120)).max(20).default([]),
  color: z.enum(Object.keys(ROOM_COLORS) as [RoomColor, ...RoomColor[]]).optional(),
  /** An uploaded picture (purpose "room") to show instead of the initials. */
  avatarKey: z.string().max(300).optional(),
  topics: z.array(z.string().trim().min(1).max(24)).max(6).default([]),
  /** People added at creation, by handle. */
  invite: z
    .array(z.string().regex(/^@?[A-Za-z0-9_]{2,24}$/).transform((h) => h.replace(/^@/, "")))
    .max(20)
    .default([]),
  disclosure: z.boolean().optional(),
  rules: z.string().trim().max(2_000).optional(),
});

export const RoomPatch = z
  .object({
    name: z.string().trim().min(3).max(40),
    description: z.string().trim().max(280),
    rules: z.string().trim().max(2_000),
    disclosure: z.boolean(),
    privacy: z.enum(["Public", "Invite only"]),
  })
  .partial()
  .strict();

export const MessageBody = z.object({
  channel: z.string().regex(/^[a-z0-9-]{1,60}$/).optional(),
  text: z.string().max(4_000).default(""),
  market: z.string().min(1).max(120).optional(),
  parentId: z.uuid().optional(),
  clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
});
