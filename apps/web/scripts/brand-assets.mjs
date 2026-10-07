// Derives every logo the app and its emails use from the brand's source
// files in public/brand (kept as delivered):
//   main-logo.png  the "imo" wordmark with its arrow, on black
//   sort-logo.png  the arrow mark alone, on transparency
//   banner.png     the wide banner (still the old name: not used until an
//                  imo banner replaces it)
// Run after replacing any of them:
//   node scripts/brand-assets.mjs
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const BRAND = "public/brand";
const APP = "src/app";
/** The app's canvas (--color-bg): icons sit on it so they read on any tab bar. */
const CANVAS = { r: 9, g: 13, b: 11, alpha: 1 };

/** The smallest box around what isn't background, plus a margin. */
async function inkBox(file, isInk, margin) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      if (!isInk(data[i], data[i + 1], data[i + 2], data[i + 3])) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  const pad = Math.round(Math.max(right - left, bottom - top) * margin);
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  return {
    left,
    top,
    width: Math.min(info.width - left, right - left + 1 + 2 * pad),
    height: Math.min(info.height - top, bottom - top + 1 + 2 * pad),
  };
}

/** Black background to transparency, keeping soft edges: brightness sets the
    alpha, and the colour is un-premultiplied so edges don't darken. */
async function blackToAlpha(input) {
  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4);
  for (let p = 0, q = 0; p < data.length; p += 3, q += 4) {
    const peak = Math.max(data[p], data[p + 1], data[p + 2]);
    const a = Math.min(1, Math.max(0, (peak - 12) / (150 - 12)));
    for (let c = 0; c < 3; c++) out[q + c] = a ? Math.min(255, Math.round(data[p + c] / Math.max(a, peak / 255))) : 0;
    out[q + 3] = Math.round(a * 255);
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } });
}

// The mark: tight, square, transparent.
const markBox = await inkBox(`${BRAND}/sort-logo.png`, (r, g, b, a) => a > 24, 0.08);
const mark = await sharp(`${BRAND}/sort-logo.png`)
  .extract(markBox)
  .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();
await sharp(mark).resize(256, 256).toFile(`${BRAND}/mark.png`);

// The wordmark: cropped, transparent, tall enough for 4× screens.
const wordBox = await inkBox(`${BRAND}/main-logo.png`, (r, g, b) => Math.max(r, g, b) > 40, 0.03);
const wordCrop = await sharp(`${BRAND}/main-logo.png`).extract(wordBox).png().toBuffer();
const wordmark = await (await blackToAlpha(wordCrop)).png().toBuffer();
await sharp(wordmark).resize({ height: 192 }).toFile(`${BRAND}/wordmark.png`);
// Emails show it 120 pixels wide; twice that for sharp screens.
await sharp(wordmark).resize({ width: 240 }).toFile(`${BRAND}/wordmark-email.png`);

// Icons, on the canvas, full bleed (browsers and iOS round corners): the
// tab icon is the mark, since a word can't be read at 16 pixels; home-screen
// and install icons are the main logo.
async function tile(size, file, glyph, share) {
  const width = Math.round(size * share);
  const input = await sharp(glyph).resize({ width, height: width, fit: "inside" }).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: CANVAS } })
    .composite([{ input, gravity: "center" }])
    .png()
    .toFile(file);
}
await tile(512, `${APP}/icon.png`, mark, 0.7);
await tile(180, `${APP}/apple-icon.png`, wordmark, 0.82);
await tile(512, `${BRAND}/app-icon-512.png`, wordmark, 0.82);
await tile(192, `${BRAND}/app-icon-192.png`, wordmark, 0.82);

// Link previews, 1200 × 630: the main logo, centred on the canvas.
const shareLogo = await sharp(wordmark).resize({ height: 200 }).toBuffer();
const share = await sharp({ create: { width: 1200, height: 630, channels: 4, background: CANVAS } })
  .composite([{ input: shareLogo, gravity: "center" }])
  .png({ compressionLevel: 9 })
  .toBuffer();
await sharp(share).toFile(`${APP}/opengraph-image.png`);
await sharp(share).toFile(`${APP}/twitter-image.png`);

// The waitlist app (apps/waitlist) serves its own copies: its logo, icons
// and link preview.
const WAITLIST = "apps/waitlist";
await mkdir(`${WAITLIST}/public/brand`, { recursive: true });
for (const [from, to] of [
  [`${BRAND}/wordmark.png`, `${WAITLIST}/public/brand/wordmark.png`],
  [`${BRAND}/mark.png`, `${WAITLIST}/public/brand/mark.png`],
  [`${APP}/icon.png`, `${WAITLIST}/app/icon.png`],
  [`${APP}/apple-icon.png`, `${WAITLIST}/app/apple-icon.png`],
  [`${APP}/opengraph-image.png`, `${WAITLIST}/app/opengraph-image.png`],
  [`${APP}/twitter-image.png`, `${WAITLIST}/app/twitter-image.png`],
])
  await copyFile(from, to);
await writeFile(`${WAITLIST}/app/opengraph-image.alt.txt`, "Claim your username on imo.");
await writeFile(`${WAITLIST}/app/twitter-image.alt.txt`, "Claim your username on imo.");

console.log("brand assets written: mark, wordmark, wordmark-email, icon, apple-icon, app-icon-192/512, opengraph-image, twitter-image, and the waitlist app's copies");
