import { z } from "zod";
import { CATEGORIES, ROLLOUT_STAGES } from "../db/schema";

export const admin = { auth: "required", role: "admin" } as const;
export const Handle = z.object({ handle: z.string().regex(/^@?[A-Za-z0-9_]{2,24}$/).transform((h) => h.replace(/^@/, "")) });
export const FlagBody = z.object({
  enabled: z.boolean(),
  rules: z
    .object({
      users: z.array(z.uuid()).max(500).optional(),
      cohorts: z.array(z.string().max(40)).max(50).optional(),
      venues: z.array(z.string().max(40)).max(50).optional(),
    })
    .optional(),
});
export const InviteBatch = z.object({
  count: z.number().int().min(1).max(200),
  maxUses: z.number().int().min(1).max(10_000).default(1),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  note: z.string().trim().max(200).optional(),
});
export const PersonChange = z
  .object({ access: z.boolean(), status: z.enum(["active", "suspended"]), role: z.enum(["user", "admin"]) })
  .partial()
  .strict();
export const MarketChange = z
  .object({ category: z.enum(CATEGORIES), hidden: z.boolean(), featured: z.boolean(), featuredLabel: z.string().trim().max(40).nullable() })
  .partial()
  .strict();
export const MappingBody = z.object({
  venueId: z.string().min(1).max(40),
  venueCategory: z.string().trim().min(1).max(80),
  category: z.enum(CATEGORIES).nullable(),
});
export const VenueChange = z
  .object({ stage: z.enum(ROLLOUT_STAGES), summary: z.string().max(280), displayAllowed: z.boolean() })
  .partial()
  .strict();
