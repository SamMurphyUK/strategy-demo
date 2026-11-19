/**
 * Slice faction reference sheets into one crisp plate per unit.
 *
 *   node scripts/sliceReferenceSheets.mjs
 *
 * Reads web/reference_sheets/{GER,USSR,UK,US,JAP}.png. When a PNG is missing,
 * it is converted from Downloads/references/<FACTION>.jpg.
 * Each isolated non-white island is a connected component. Islands are matched
 * to the 14 unit types with a checked label table for these sheets.
 * Germany's sheet has no destroyer (it drew a second submarine and a second
 * battleship instead); that unit gets a 48×48 blockout.
 */
import { access, copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { FACTION_MILITARY_MAPPINGS, MILITARY } from "../dev/militaryStrip.mjs";
import { encodeRgbaPng } from "../dev/pngRgba.mjs";
import { AIR_UNITS, FACTIONS, UNIT_TYPES, bakePromptFor, historicalName } from "./historicalUnits.mjs";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHEET_DIR = path.join(WEB_ROOT, "reference_sheets");
const OUT_DIR = path.join(WEB_ROOT, "reference_plates");
const SOURCE_JPG_DIR = "C:/Users/sammu/Downloads/references";
const PLATE = 48;
const PREVIEW = 256;
const MIN_AREA = 2000;
const WHITE = 242;

/**
 * Unit id for each island after sorting top-to-bottom, then left-to-right.
 * null is an extra drawing on that sheet and is not used as a plate.
 */
export const SHEET_LABELS = {
  GER: [
    "aaa",
    "infantry",
    "mech_infantry",
    "tank",
    "artillery",
    "transport",
    "submarine",
    null,
    null,
    "carrier",
    "cruiser",
    "bomber",
    "tac_bomber",
    "fighter",
    "battleship",
  ],
  USSR: [
    "aaa",
    "infantry",
    "tank",
    "mech_infantry",
    "submarine",
    "artillery",
    "transport",
    "cruiser",
    "destroyer",
    "carrier",
    "bomber",
    "tac_bomber",
    "fighter",
    "battleship",
  ],
  UK: [
    "aaa",
    "infantry",
    "tank",
    "submarine",
    "mech_infantry",
    "artillery",
    "cruiser",
    "transport",
    "destroyer",
    null,
    "carrier",
    "bomber",
    "fighter",
    "tac_bomber",
    "battleship",
  ],
  US: [
    "tank",
    "infantry",
    "mech_infantry",
    "artillery",
    "aaa",
    "submarine",
    "transport",
    "cruiser",
    "destroyer",
    "bomber",
    "carrier",
    "tac_bomber",
    "fighter",
    "battleship",
  ],
  JAP: [
    "infantry",
    "aaa",
    "tank",
    "artillery",
    "mech_infantry",
    "submarine",
    "transport",
    "cruiser",
    "destroyer",
    "carrier",
    "bomber",
    "tac_bomber",
    "fighter",
    "battleship",
  ],
};

function isBackground(r, g, b, a) {
  return a < 16 || (r > WHITE && g > WHITE && b > WHITE);
}

/** Connected-component bounding boxes of non-white pixels. */
export function spriteIslands(rgba, width, height, minArea = MIN_AREA) {
  const seen = new Uint8Array(width * height);
  const boxes = [];
  const qx = [0, 1, 0, -1];
  const qy = [1, 0, -1, 0];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      const offset = pixel * 4;
      if (seen[pixel] || isBackground(rgba[offset], rgba[offset + 1], rgba[offset + 2], rgba[offset + 3])) {
        continue;
      }
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let area = 0;
      const stack = [pixel];
      seen[pixel] = 1;
      while (stack.length > 0) {
        const current = stack.pop();
        const cx = current % width;
        const cy = (current / width) | 0;
        area += 1;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        for (let k = 0; k < 4; k++) {
          const nx = cx + qx[k];
          const ny = cy + qy[k];
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          const nextOffset = next * 4;
          if (seen[next] || isBackground(rgba[nextOffset], rgba[nextOffset + 1], rgba[nextOffset + 2], rgba[nextOffset + 3])) {
            continue;
          }
          seen[next] = 1;
          stack.push(next);
        }
      }
      if (area >= minArea) {
        boxes.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area });
      }
    }
  }
  boxes.sort((a, b) => a.y - b.y || a.x - b.x);
  return boxes;
}

export function labelIslands(factionId, count) {
  const labels = SHEET_LABELS[factionId];
  if (!labels) {
    throw new Error(`No label table for ${factionId}`);
  }
  if (labels.length !== count) {
    throw new Error(`${factionId} sheet has ${count} islands; the checked table expects ${labels.length}`);
  }
  return labels;
}

function hexRgb(hex) {
  const rgb = Number.parseInt(hex.slice(1), 16);
  return { r: (rgb >> 16) & 255, g: (rgb >> 8) & 255, b: rgb & 255 };
}

/** Flat 48×48 stand-in used when a sheet has no drawing for that unit. */
export function blockoutPng(factionId, unitTypeId) {
  const color = hexRgb(MILITARY[FACTION_MILITARY_MAPPINGS[factionId].primary_uniform_or_hull]);
  const rgba = new Uint8ClampedArray(PLATE * PLATE * 4);
  const dot = (x, y) => {
    if (x < 0 || y < 0 || x >= PLATE || y >= PLATE) return;
    const offset = (y * PLATE + x) * 4;
    rgba[offset] = color.r;
    rgba[offset + 1] = color.g;
    rgba[offset + 2] = color.b;
    rgba[offset + 3] = 255;
  };
  const fill = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) dot(x, y);
    }
  };
  if (AIR_UNITS.has(unitTypeId)) {
    fill(8, 20, 40, 27);
    fill(20, 8, 27, 40);
  } else if (unitTypeId === "infantry") {
    fill(20, 8, 27, 16);
    fill(16, 16, 31, 32);
    fill(18, 32, 22, 42);
    fill(26, 32, 30, 42);
  } else {
    fill(6, 22, 42, 36);
    fill(24, 14, 36, 22);
  }
  return encodeRgbaPng(PLATE, PLATE, rgba);
}

async function ensureSheet(factionId) {
  await mkdir(SHEET_DIR, { recursive: true });
  const dest = path.join(SHEET_DIR, `${factionId}.png`);
  try {
    await access(dest);
    return dest;
  } catch {
    const jpg = path.join(SOURCE_JPG_DIR, `${factionId}.jpg`);
    await sharp(jpg).png().toFile(dest);
    return dest;
  }
}

async function fitPng(input, size) {
  return sharp(input)
    .resize(size, size, {
      fit: "contain",
      kernel: "nearest",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function contactHtml(entries) {
  const byKey = new Map(entries.map((entry) => [`${entry.factionId}:${entry.unitTypeId}`, entry]));
  const head = FACTIONS.map((factionId) => `<th>${factionId}</th>`).join("");
  const rows = UNIT_TYPES.map((unitTypeId) => {
    const cells = FACTIONS.map((factionId) => {
      const entry = byKey.get(`${factionId}:${unitTypeId}`);
      const src = `${factionId}/${unitTypeId}.preview.png`;
      const flag = entry.source === "blockout" ? `<p class="warn">No island on the sheet. 48×48 blockout.</p>` : "";
      return `<td>
        <img src="${escapeHtml(src)}" width="128" height="128" alt="${escapeHtml(historicalName(factionId, unitTypeId))}"/>
        <div class="name">${escapeHtml(historicalName(factionId, unitTypeId))}</div>
        ${flag}
        <textarea readonly rows="4">${escapeHtml(bakePromptFor(factionId, unitTypeId))}</textarea>
      </td>`;
    }).join("");
    return `<tr><th>${escapeHtml(unitTypeId)}</th>${cells}</tr>`;
  }).join("");
  const extras = entries
    .filter((entry) => entry.extra)
    .map(
      (entry) =>
        `<figure><img src="${escapeHtml(entry.preview)}" width="160" alt=""/><figcaption>${escapeHtml(entry.factionId)} extra island, not used</figcaption></figure>`,
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Reference plates</title>
  <style>
    body { margin: 24px; background: #1c1917; color: #f5f0e6; font: 14px/1.4 "Segoe UI", sans-serif; }
    table { border-collapse: collapse; }
    th, td { border: 1px solid #4b3d44; padding: 8px; vertical-align: top; }
    img { image-rendering: pixelated; background: #f4f1ea; }
    textarea { width: 220px; margin-top: 6px; }
    .warn { color: #ddcf99; }
    .name { max-width: 220px; margin-top: 6px; }
  </style>
</head>
<body>
  <h1>Reference plates</h1>
  <p>Fourteen unit types for GER, USSR, UK, US, and JAP. Check these before the overnight batch.</p>
  <table>
    <thead><tr><th>Unit</th>${head}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <h2>Islands left unused</h2>
  <div>${extras || "<p>None.</p>"}</div>
</body>
</html>
`;
}

export async function sliceSheets() {
  await mkdir(OUT_DIR, { recursive: true });
  const entries = [];
  for (const factionId of FACTIONS) {
    const sheetPath = await ensureSheet(factionId);
    const { data, info } = await sharp(sheetPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const islands = spriteIslands(data, info.width, info.height);
    const labels = labelIslands(factionId, islands.length);
    const factionDir = path.join(OUT_DIR, factionId);
    await mkdir(factionDir, { recursive: true });
    const found = new Set();
    for (let index = 0; index < islands.length; index++) {
      const unitTypeId = labels[index];
      const box = islands[index];
      let crop = await sharp(sheetPath)
        .extract({ left: box.x, top: box.y, width: box.w, height: box.h })
        .png()
        .toBuffer();
      if (unitTypeId != null && AIR_UNITS.has(unitTypeId)) {
        // These sheets draw aircraft nose-up. The bake prompt wants the nose to the right.
        crop = await sharp(crop).rotate(90).png().toBuffer();
      }
      if (unitTypeId == null) {
        const preview = `${factionId}/extra_${index}.preview.png`;
        await sharp(await fitPng(crop, PREVIEW)).toFile(path.join(OUT_DIR, preview));
        entries.push({ factionId, extra: true, preview });
        continue;
      }
      found.add(unitTypeId);
      const plate = await fitPng(crop, PLATE);
      const preview = await fitPng(crop, PREVIEW);
      await sharp(plate).toFile(path.join(factionDir, `${unitTypeId}.png`));
      await sharp(preview).toFile(path.join(factionDir, `${unitTypeId}.preview.png`));
      entries.push({ factionId, unitTypeId, source: "sheet" });
    }
    for (const unitTypeId of UNIT_TYPES) {
      if (found.has(unitTypeId)) continue;
      const plate = blockoutPng(factionId, unitTypeId);
      await writeFile(path.join(factionDir, `${unitTypeId}.png`), plate);
      await sharp(plate)
        .resize(PREVIEW, PREVIEW, { kernel: "nearest" })
        .png()
        .toFile(path.join(factionDir, `${unitTypeId}.preview.png`));
      entries.push({ factionId, unitTypeId, source: "blockout" });
      console.log(`${factionId} ${unitTypeId}: blockout (no island on the sheet)`);
    }
  }
  const html = contactHtml(entries);
  await writeFile(path.join(OUT_DIR, "index.html"), html, "utf8");
  return { entries, htmlPath: path.join(OUT_DIR, "index.html") };
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === path.resolve(fileURLToPath(import.meta.url))) {
  sliceSheets()
    .then((result) => {
      console.log(`Wrote ${result.htmlPath}`);
    })
    .catch((error) => {
      console.error(error?.message ?? error);
      process.exitCode = 1;
    });
}

export async function copyPlatesTo(destDir) {
  const html = await readFile(path.join(OUT_DIR, "index.html"));
  await mkdir(destDir, { recursive: true });
  await writeFile(path.join(destDir, "index.html"), html);
  for (const factionId of FACTIONS) {
    const from = path.join(OUT_DIR, factionId);
    const to = path.join(destDir, factionId);
    await mkdir(to, { recursive: true });
    for (const name of await readdir(from)) {
      await copyFile(path.join(from, name), path.join(to, name));
    }
  }
}
