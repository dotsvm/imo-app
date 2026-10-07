import { z } from "zod";
import { FEEDS } from "../usecases/posts";

export const PostBody = z.object({
  market: z.string().min(1).max(120),
  outcome: z.enum(["Yes", "No"]),
  text: z.string().trim().min(1, "Write something first.").max(600),
  invalidation: z.string().trim().max(600).optional(),
  confidence: z.enum(["Low", "Medium", "High"]),
  disclosePosition: z.boolean().default(false),
  audience: z.string().min(1).max(80).default("public"),
  images: z
    .array(
      z.object({
        key: z.string().max(300),
        alt: z.string().trim().min(1, "Describe the image for people who can't see it.").max(300),
        caption: z.string().trim().max(300).optional(),
        width: z.number().int().min(1).max(8_000),
        height: z.number().int().min(1).max(8_000),
      }),
    )
    .max(4)
    .optional(),
  clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
});

export const PostPatch = z
  .object({
    text: z.string().trim().min(1).max(600),
    invalidation: z.string().trim().max(600).nullable(),
    confidence: z.enum(["Low", "Medium", "High"]),
  })
  .partial()
  .strict();

export const FeedQuery = z.object({
  feed: z.enum(FEEDS).optional(),
  market: z.string().min(1).max(120).optional(),
  trader: z.string().regex(/^@?[A-Za-z0-9_]{2,24}$/).transform((h) => h.replace(/^@/, "")).optional(),
  room: z.string().min(1).max(80).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const IdParams = z.object({ id: z.uuid() });
export const CommentBody = z.object({
  text: z.string().trim().min(1).max(2_000),
  parentId: z.uuid().optional(),
  clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
});
