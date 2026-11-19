// Composite the emblems listed in each <stem>.stamps.json onto its polished PNG, into a new
// <stem>.outlined.stamped.png beside it. The polished PNG is read, never written.
//
//   npm run stamp:units
//   npm run stamp:units -- assets/candidates/US/us_bomber_seed1.stamps.json
//   npm run stamp:units -- assets/candidates/US/us_bomber_seed1.outlined.polished.png
//
// Then npm run vectorize:units -- --stamped traces the stamped PNGs. A stamps file with no stamps
// removes its stale stamped PNG, and the next --stamped run drops its vector.
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeRgbaPng, encodeRgbaPng } from "../dev/pngRgba.mjs";
import { emblemById } from "../src/art/emblems.ts";
import {
  POLISHED_PNG_SUFFIX,
  STAMPS_SUFFIX,
  compositeStamps,
  readStampSidecar,
  stampedPngPathFor,
  stampsPathFor,
} from "../src/art/spriteStamps.ts";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANDIDATES = path.join(WEB_ROOT, "assets", "candidates");

function relative(file) {
  return path.relative(WEB_ROOT, path.resolve(file)).split(path.sep).join("/");
}

async function everySidecar() {
  const found = [];
  for (const faction of await readdir(CANDIDATES, { withFileTypes: true })) {
    if (!faction.isDirectory()) {
      continue;
    }
    for (const name of (await readdir(path.join(CANDIDATES, faction.name))).sort()) {
      if (name.endsWith(STAMPS_SUFFIX)) {
        found.push(`assets/candidates/${faction.name}/${name}`);
      }
    }
  }
  return found;
}

function sidecarFor(arg) {
  const rel = relative(arg);
  if (rel.endsWith(POLISHED_PNG_SUFFIX)) {
    return stampsPathFor(rel);
  }
  if (rel.endsWith(STAMPS_SUFFIX)) {
    return rel;
  }
  throw new Error(`${arg} is neither a stamps file nor a polished PNG.`);
}

async function exists(file) {
  return readFile(file).then(
    () => true,
    () => false,
  );
}

async function stampOne(sidecarRel) {
  const sidecar = readStampSidecar(JSON.parse(await readFile(path.join(WEB_ROOT, sidecarRel), "utf8")));
  if (stampsPathFor(sidecar.source) !== sidecarRel) {
    throw new Error(`${sidecarRel} names ${sidecar.source}, which belongs to another stamps file.`);
  }
  const stampedRel = stampedPngPathFor(sidecar.source);
  const stampedFile = path.join(WEB_ROOT, stampedRel);
  if (sidecar.stamps.length === 0) {
    if (await exists(stampedFile)) {
      await rm(stampedFile);
      console.log(`${sidecarRel}: no stamps. Removed ${stampedRel}.`);
    } else {
      console.log(`${sidecarRel}: no stamps. Nothing to do.`);
    }
    return;
  }
  const sprite = decodeRgbaPng(await readFile(path.join(WEB_ROOT, sidecar.source)));
  if (sprite.width !== sidecar.width || sprite.height !== sidecar.height) {
    throw new Error(`${sidecar.source} is ${sprite.width}x${sprite.height}, but ${sidecarRel} was placed on ${sidecar.width}x${sidecar.height}.`);
  }
  const { data, written } = compositeStamps(sprite, sidecar.stamps);
  await writeFile(stampedFile, encodeRgbaPng(sprite.width, sprite.height, data));
  console.log(`${sidecar.source} -> ${stampedRel} (${sprite.width}x${sprite.height})`);
  sidecar.stamps.forEach((stamp, index) => {
    const extras = [stamp.turn ? "turned" : "", stamp.flip ? "flipped" : "", stamp.onlyOnSprite ? "" : "may spill off the sprite"].filter(Boolean);
    const blank = written[index] === 0 ? " Nothing landed: no sprite under it." : "";
    console.log(`  ${emblemById(stamp.emblem)?.name ?? stamp.emblem} ${stamp.size} at ${stamp.x}, ${stamp.y}${extras.length ? ` (${extras.join(", ")})` : ""}: ${written[index]} pixels.${blank}`);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const sidecars = args.length > 0 ? args.map(sidecarFor) : await everySidecar();
  if (sidecars.length === 0) {
    console.log("No stamps files. Place emblems in the sprite editor (?bake=1) and press Save stamps.");
    return;
  }
  let failed = 0;
  for (const sidecarRel of sidecars) {
    try {
      await stampOne(sidecarRel);
    } catch (error) {
      failed += 1;
      console.error(`${sidecarRel}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`stamped ${sidecars.length - failed} of ${sidecars.length}`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

await main();
