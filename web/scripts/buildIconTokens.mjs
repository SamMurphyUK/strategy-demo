// Builds unit-token PNGs from a sheet of black silhouettes (one per row band, top to bottom).
// Output matches the existing tokens in assets/units: a 794 x 1123 artboard, the white disc and grey ring at
// the same place and colour, and a black silhouette. The renderer discards the disc and ring and redraws them
// per faction, so only the silhouette and its place in the circle matter.
//
//   node scripts/buildIconTokens.mjs C:/Art/web/public/assets/icons/ref_sheet.svg
//
// Writes to public/assets/units/, replacing the token of the same name. Back the folder up first.
// allies_inf_ii.png is not in the sheet and is left alone.

import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const sheetPath = process.argv[2];
if (!sheetPath) {
  console.error("usage: node scripts/buildIconTokens.mjs <ref_sheet.svg>");
  process.exit(1);
}

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/assets/units");
const BOARD = { width: 794, height: 1123 };
const CIRCLE = { cx: 393.5, cy: 428, outer: 280, ring: 16 };
const FILL = "#f9f8f6";
const RING = "#8a8c7f";

/**
 * Band index in the sheet (top to bottom) -> token. `bottom` sets a baseline; `centre` centres on the circle.
 * `cx` moves the horizontal centre. The first eight reuse the place of the tokens they replaced, so the art
 * sits where the old art did. The old tokens are kept in backups/unit-tokens-pre-icon-sheet/.
 */
const TOKENS = [
  { name: "axis_aa", band: 0, width: 523, bottom: 586, cx: 158 + 523 / 2 },
  { name: "axis_art", band: 1, width: 526, bottom: 583, cx: 130 + 526 / 2 },
  { name: "axis_inf_ii", band: 2, width: 423, bottom: 663, cx: 231 + 423 / 2 },
  { name: "axis_mech", band: 3, width: 600, bottom: 575 },
  { name: "axis_tank", band: 4, width: 715, bottom: 565, cx: 55 + 715 / 2 },
  { name: "axis_strategic_bomber", band: 5, width: 740, centre: true },
  { name: "axis_tactical_bomber", band: 6, width: 640, centre: true },
  { name: "axis_fighter", band: 7, width: 560, centre: true },
  { name: "axis_sub", band: 8, width: 729, bottom: 564, cx: 21 + 729 / 2 },
  { name: "axis_cruiser", band: 10, width: 674, bottom: 580, cx: 38 + 674 / 2 },
  { name: "axis_battleship", band: 11, width: 720, bottom: 578 },
  { name: "axis_carrier", band: 12, width: 760, bottom: 575 },
  { name: "axis_trans", band: 13, width: 637, bottom: 578, cx: 66 + 637 / 2 },
  { name: "axis_des", band: 14, width: 602, bottom: 554, cx: 83 + 602 / 2 },
];

const sheet = await sharp(sheetPath, { density: 144 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = sheet.info;
const inked = (x, y) => sheet.data[(y * W + x) * 4 + 3] > 128;

const rows = new Uint8Array(H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (inked(x, y)) {
      rows[y] = 1;
      break;
    }
  }
}
const bands = [];
let start = -1;
for (let y = 0; y <= H; y++) {
  if (y < H && rows[y]) {
    if (start < 0) start = y;
  } else if (start >= 0) {
    if (y - start > 30) bands.push([start, y - 1]);
    start = -1;
  }
}
console.log(`${bands.length} silhouettes found in the sheet`);

const disc = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${BOARD.width}" height="${BOARD.height}"><circle cx="${CIRCLE.cx}" cy="${CIRCLE.cy}" r="${CIRCLE.outer - CIRCLE.ring / 2}" fill="${FILL}" stroke="${RING}" stroke-width="${CIRCLE.ring}"/></svg>`,
);

await mkdir(out, { recursive: true });
for (const token of TOKENS) {
  const band = bands[token.band];
  if (!band) throw new Error(`no band ${token.band} for ${token.name}`);
  let x0 = W;
  let x1 = -1;
  for (let y = band[0]; y <= band[1]; y++) {
    for (let x = 0; x < W; x++) {
      if (inked(x, y)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
    }
  }
  const crop = await sharp(sheet.data, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: x0, top: band[0], width: x1 - x0 + 1, height: band[1] - band[0] + 1 })
    .resize({ width: token.width, kernel: "lanczos3" })
    .png()
    .toBuffer({ resolveWithObject: true });
  const left = Math.round((token.cx ?? CIRCLE.cx) - crop.info.width / 2);
  const top = token.centre ? Math.round(CIRCLE.cy - crop.info.height / 2) : Math.round(token.bottom - crop.info.height);
  await sharp(disc)
    .composite([{ input: crop.data, left, top }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(out, `${token.name}.png`));
  console.log(token.name, `${crop.info.width}x${crop.info.height} at ${left},${top}`);
}
