/**
 * Uploads: the browser asks for a ticket, uploads straight to storage, then
 * names the key when it saves a profile or a prediction. The server checks
 * what actually arrived — type and size — before anything points at it.
 */
import { randomUUID } from "node:crypto";
import type { Deps } from "../composition";
import { forbidden, invalid } from "../errors";
import type { Viewer } from "./viewer";

export const UPLOAD_PURPOSES = {
  avatar: { prefix: "avatars", maxBytes: 5 * 1024 * 1024 },
  room: { prefix: "rooms", maxBytes: 5 * 1024 * 1024 },
  evidence: { prefix: "evidence", maxBytes: 10 * 1024 * 1024 },
} as const;
export type UploadPurpose = keyof typeof UPLOAD_PURPOSES;

/** Raster images only: SVG can carry script. */
export const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function requestUpload(
  deps: Pick<Deps, "storage">,
  viewer: Viewer,
  input: { purpose: UploadPurpose; contentType: string; bytes: number },
) {
  const rule = UPLOAD_PURPOSES[input.purpose];
  const ext = IMAGE_TYPES[input.contentType];
  if (!ext) throw invalid("Upload a PNG, JPEG, WebP or GIF image.");
  if (input.bytes > rule.maxBytes)
    throw invalid(`Images can be up to ${rule.maxBytes / 1024 / 1024} MB.`);
  const key = `${rule.prefix}/${viewer.userId}/${randomUUID()}.${ext}`;
  const ticket = await deps.storage.signUpload(key, {
    contentType: input.contentType,
    maxBytes: rule.maxBytes,
  });
  return { key, upload: ticket, publicUrl: deps.storage.publicUrl(key) };
}

/** An uploaded image this person may use for this purpose. */
export async function checkUpload(
  deps: Pick<Deps, "storage">,
  viewer: Viewer,
  purpose: UploadPurpose,
  key: string,
) {
  const rule = UPLOAD_PURPOSES[purpose];
  if (!key.startsWith(`${rule.prefix}/${viewer.userId}/`))
    throw forbidden("That image isn't yours to use.");
  const stored = await deps.storage.stat(key);
  if (!stored) throw invalid("Upload the image before saving.");
  if (!IMAGE_TYPES[stored.contentType] || stored.bytes > rule.maxBytes)
    throw invalid("That upload isn't an image we can use.");
  return stored;
}
