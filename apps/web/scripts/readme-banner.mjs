/**
 * The README banner: the brand banner's glow, the imo wordmark, and the line
 * that says what imo is. Run from apps/web: node scripts/readme-banner.mjs
 * Writes ../../docs/assets/banner.png (and a narrower social card).
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const brand = join(here, "../public/brand");
const out = join(here, "../../../docs/assets");
mkdirSync(out, { recursive: true });

const W = 2048;
const H = 768;
const BG = "#050504";

// The wordmark, cropped tight from the square logo (green on black).
const wordmark = await sharp(join(brand, "main-logo.png"))
  .extract({ left: 340, top: 480, width: 620, height: 285 })
  .resize({ height: 168 })
  .toBuffer();
const { width: wordW } = await sharp(wordmark).metadata();

const text = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .tag { font-family: Geist, 'Geist Medium', Helvetica, Arial, sans-serif; font-weight: 500; fill: #eeefea; }
    .sub { font-family: Geist, Helvetica, Arial, sans-serif; font-weight: 400; fill: #969ca6; }
    .pill { font-family: Geist, Helvetica, Arial, sans-serif; font-weight: 500; fill: #b5e6a1; }
  </style>
  <text x="${W / 2}" y="510" text-anchor="middle" class="tag" font-size="46" letter-spacing="-0.6">The social network for prediction markets</text>
  <text x="${W / 2}" y="566" text-anchor="middle" class="sub" font-size="28">Call it, back it with real money, and let your record speak.</text>
  <g transform="translate(${W / 2 - 300}, 612)">
    <rect width="600" height="52" rx="26" fill="#0f1a13" stroke="#2c4a33" stroke-width="1.5"/>
    <text x="300" y="34" text-anchor="middle" class="pill" font-size="22" letter-spacing="0.4">SOLANA · JUPITER PREDICT · SEEKER</text>
  </g>
</svg>`;

// Cover the old wordmark, then lay the new one and the words on top.
const cover = Buffer.from(
  `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect x="704" y="262" width="650" height="200" rx="24" fill="${BG}"/></svg>`,
);

await sharp(join(brand, "banner.png"))
  .resize(W, H)
  .composite([
    { input: cover },
    // "lighten" drops the logo's black backdrop into the banner's own black.
    { input: wordmark, top: 250, left: Math.round(W / 2 - wordW / 2), blend: "lighten" },
    { input: Buffer.from(text) },
  ])
  .png({ compressionLevel: 9 })
  .toFile(join(out, "banner.png"));

console.log("wrote docs/assets/banner.png");
