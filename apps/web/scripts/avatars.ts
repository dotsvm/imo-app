/**
 * Draws the illustrated avatars (packages/core/src/avatars.ts) into public/avatars:
 * DiceBear's "Lorelei" by Lisa Wischofsky (CC0 1.0), rendered here once so
 * the app serves them itself. Run after changing the presets:
 *   npx tsx apps/web/scripts/avatars.ts
 */
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { createAvatar } from "@dicebear/core";
import * as lorelei from "@dicebear/lorelei";
import { AVATAR_PRESETS } from "@imo/core/avatars";

const DIR = "public/avatars";
/** The waitlist app serves them too: the pass's reactions wear four, and
    your own (any of them) sits beside the post you share. */
const WAITLIST_DIR = "apps/waitlist/public/avatars";

async function main() {
  await mkdir(DIR, { recursive: true });
  // The folder holds exactly the catalog: presets no longer listed go.
  const wanted = new Set(AVATAR_PRESETS.map((p) => `${p.id}.svg`));
  for (const file of await readdir(DIR)) if (file.endsWith(".svg") && !wanted.has(file)) await rm(`${DIR}/${file}`);
  for (const preset of AVATAR_PRESETS) {
    const svg = createAvatar(lorelei, {
      seed: preset.seed,
      backgroundColor: [preset.background],
      backgroundType: ["solid"],
    }).toString();
    await writeFile(`${DIR}/${preset.id}.svg`, svg);
  }
  await mkdir(WAITLIST_DIR, { recursive: true });
  for (const file of await readdir(WAITLIST_DIR)) if (file.endsWith(".svg") && !wanted.has(file)) await rm(`${WAITLIST_DIR}/${file}`);
  for (const preset of AVATAR_PRESETS) await copyFile(`${DIR}/${preset.id}.svg`, `${WAITLIST_DIR}/${preset.id}.svg`);
  console.log(`${AVATAR_PRESETS.length} avatars written to ${DIR} and copied to ${WAITLIST_DIR}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
