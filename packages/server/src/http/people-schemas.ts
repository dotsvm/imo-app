import { z } from "zod";
import { AVATAR_PRESET_IDS } from "@imo/core/avatars";
import { CATEGORIES } from "../db/schema";

export const HandleParams = z.object({ handle: z.string().regex(/^@?[A-Za-z0-9_]{2,24}$/).transform((h) => h.replace(/^@/, "")) });

export const ProfilePatch = z
  .object({
    displayName: z.string().trim().min(1).max(50),
    handle: z.string().regex(/^[A-Za-z0-9_]{2,24}$/, "2–24 letters, numbers or underscores"),
    bio: z.string().trim().max(280),
    focus: z.string().trim().max(60),
    region: z.string().trim().max(60),
    avatarKey: z.string().max(300).nullable(),
    /** One of the illustrated avatars, in place of a photo. */
    avatarPreset: z.enum(AVATAR_PRESET_IDS),
    theme: z.enum(["Midnight", "Dim", "System"]),
    priceInCents: z.boolean(),
    showPositionsOnPosts: z.boolean(),
    appearOnLeaderboard: z.boolean(),
    privateOpenPositions: z.boolean(),
    interests: z.array(z.enum(CATEGORIES)).max(CATEGORIES.length),
    onboarded: z.boolean(),
  })
  .partial()
  .strict();
