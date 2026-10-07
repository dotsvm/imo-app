/**
 * Illustrated avatars: DiceBear's "Lorelei" (art by Lisa Wischofsky, CC0),
 * drawn once by apps/web/scripts/avatars.ts into public/avatars and served from our
 * own origin, so no image service learns who is looking at whom. Everyone
 * wears one until they pick another or upload a photo.
 */

/** Each preset's seed picks the face; backgrounds are the design system's
    six, spread so that neighbours differ however the grid wraps. */
export const AVATAR_PRESETS = [
  { id: "lorelei-01", seed: "imo-5", background: "a9c9b3" },
  { id: "lorelei-02", seed: "imo-12", background: "cfc3a8" },
  { id: "lorelei-03", seed: "imo-19", background: "b3b9cc" },
  { id: "lorelei-04", seed: "imo-22", background: "d1b3b0" },
  { id: "lorelei-05", seed: "imo-15", background: "a8c3c7" },
  { id: "lorelei-06", seed: "imo-23", background: "bdb3cf" },
  { id: "lorelei-07", seed: "imo-6", background: "cfc3a8" },
  { id: "lorelei-08", seed: "imo-42", background: "b3b9cc" },
  { id: "lorelei-09", seed: "imo-35", background: "d1b3b0" },
  { id: "lorelei-10", seed: "imo-48", background: "a8c3c7" },
  { id: "lorelei-11", seed: "imo-3", background: "bdb3cf" },
  { id: "lorelei-12", seed: "imo-28", background: "a9c9b3" },
  { id: "lorelei-13", seed: "imo-14", background: "b3b9cc" },
  { id: "lorelei-14", seed: "imo-17", background: "d1b3b0" },
  { id: "lorelei-15", seed: "imo-8", background: "a8c3c7" },
  { id: "lorelei-16", seed: "imo-39", background: "bdb3cf" },
  { id: "lorelei-17", seed: "imo-31", background: "a9c9b3" },
  { id: "lorelei-18", seed: "imo-41", background: "cfc3a8" },
  { id: "lorelei-19", seed: "imo-13", background: "d1b3b0" },
  { id: "lorelei-20", seed: "imo-24", background: "a8c3c7" },
  { id: "lorelei-21", seed: "imo-33", background: "bdb3cf" },
  { id: "lorelei-22", seed: "imo-44", background: "a9c9b3" },
  { id: "lorelei-23", seed: "imo-37", background: "cfc3a8" },
  { id: "lorelei-24", seed: "imo-18", background: "b3b9cc" },
] as const;

export type AvatarPreset = (typeof AVATAR_PRESETS)[number]["id"];

export const AVATAR_PRESET_IDS = AVATAR_PRESETS.map((p) => p.id) as [AvatarPreset, ...AvatarPreset[]];

export const isAvatarPreset = (value: string): value is AvatarPreset =>
  (AVATAR_PRESET_IDS as readonly string[]).includes(value);

export const presetUrl = (id: AvatarPreset) => `/avatars/${id}.svg`;

/** The preset an avatar URL shows, or null: a photo. */
export function presetOf(url: string | null | undefined): AvatarPreset | null {
  const id = url?.match(/^\/avatars\/([a-z0-9-]+)\.svg$/)?.[1];
  return id && isAvatarPreset(id) ? id : null;
}

/** What someone wears until they choose: always the same one, from their
    id (FNV-1a), so it never changes behind their back. */
export function defaultAvatar(id: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 0x01000193);
  return presetUrl(AVATAR_PRESETS[(hash >>> 0) % AVATAR_PRESETS.length]!.id);
}
