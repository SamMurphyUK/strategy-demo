// Reclip an existing map against the land SVG and recompute pins and neighbors.
//
// The SVG is a land mask. Its <path> elements are anonymous coastlines: no id, no
// inkscape:label, and no fill that names a territory. Sea zones are not in the file.
// Territory ids, owners, IPC, facilities and starting units live on the map JSON and
// are copied through unchanged.
//
// Prints a report. Writes a file only with --out, and never onto the source path.
//
//   npm run rebuild-map-geometry
//   npm run rebuild-map-geometry -- --out ../demomap01.rebuilt.json

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import polygonClipping from "polygon-clipping";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const mapPath = resolve(flag("--map", resolve(root, "demomap01.json")));
const svgPath = resolve(flag("--svg", resolve(root, "web/public/assets/ne_110m_land_FINAL_02.svg")));
const outPath = args.includes("--out") ? resolve(flag("--out", "")) : "";
const MIN_UNCLAIMED = 2;
const VERTEX_EPS = 1.5;
const COAST_STEP = 2;
const COAST_REACH = 3;

if (outPath && resolve(outPath) === mapPath) {
  console.error("--out must be a different file from --map. This command does not overwrite the source.");
  process.exit(1);
}

function parsePathRings(d) {
  const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const rings = [];
  let ring = [];
  let cmd = "";
  let x = 0;
  let y = 0;
  let i = 0;
  const num = () => Number(tokens[i++]);
  const flush = () => {
    if (ring.length >= 3) rings.push(ring);
    ring = [];
  };
  const isCmd = (t) => t !== undefined && /^[A-Za-z]$/.test(t);
  while (i < tokens.length) {
    if (isCmd(tokens[i])) cmd = tokens[i++];
    else if (cmd === "") throw new Error("Path data must start with a command");
    const rel = cmd === cmd.toLowerCase();
    const U = cmd.toUpperCase();
    if (U === "M" || U === "L") {
      if (U === "M") flush();
      const nx = num();
      const ny = num();
      x = rel ? x + nx : nx;
      y = rel ? y + ny : ny;
      ring.push([+x.toFixed(4), +y.toFixed(4)]);
      if (U === "M") cmd = rel ? "l" : "L";
    } else if (U === "H") {
      const nx = num();
      x = rel ? x + nx : nx;
      ring.push([+x.toFixed(4), +y.toFixed(4)]);
    } else if (U === "V") {
      const ny = num();
      y = rel ? y + ny : ny;
      ring.push([+x.toFixed(4), +y.toFixed(4)]);
    } else if (U === "Z") {
      flush();
      cmd = "";
    } else {
      throw new Error(`Unsupported path command "${cmd}" in ${svgPath}`);
    }
  }
  flush();
  return rings;
}

function openRing(ring) {
  const out = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a) / 2;
}

function multiArea(mp) {
  let total = 0;
  for (const poly of mp) {
    poly.forEach((ring, i) => {
      total += i === 0 ? ringArea(ring) : -ringArea(ring);
    });
  }
  return total;
}

function centroid(ring) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const c = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += c;
    cx += (ring[j][0] + ring[i][0]) * c;
    cy += (ring[j][1] + ring[i][1]) * c;
  }
  if (Math.abs(a) < 1e-9) {
    const s = ring.reduce((p, q) => [p[0] + q[0], p[1] + q[1]], [0, 0]);
    return [s[0] / ring.length, s[1] / ring.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

function pointInRing(p, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function pointInMulti(p, mp) {
  let inside = false;
  for (const poly of mp) {
    for (const ring of poly) {
      if (pointInRing(p, ring)) inside = !inside;
    }
  }
  return inside;
}

function boxOf(ring) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of ring) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

function boxesApart(a, b, pad) {
  return a.x1 + pad < b.x0 || b.x1 + pad < a.x0 || a.y1 + pad < b.y0 || b.y1 + pad < a.y0;
}

function distToSeg(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function clearance(p, rings) {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      best = Math.min(best, distToSeg(p, ring[i], ring[(i + 1) % ring.length]));
    }
  }
  return best;
}

/** Point inside the shape furthest from its edge. Same job as polylabel. */
function interiorPoint(mp) {
  let bestPoly = mp[0];
  let bestArea = -1;
  for (const poly of mp) {
    const area = ringArea(poly[0]);
    if (area > bestArea) {
      bestArea = area;
      bestPoly = poly;
    }
  }
  const rings = bestPoly.map(openRing);
  const box = boxOf(rings[0]);
  let step = Math.max(box.x1 - box.x0, box.y1 - box.y0) / 24;
  if (!(step > 0)) return centroid(rings[0]);
  let best = null;
  const scan = (x0, y0, x1, y1) => {
    for (let x = x0; x <= x1 + 1e-9; x += step) {
      for (let y = y0; y <= y1 + 1e-9; y += step) {
        const p = [x, y];
        if (!pointInMulti(p, [rings])) continue;
        const d = clearance(p, rings);
        if (!best || d > best.d) best = { p, d };
      }
    }
  };
  scan(box.x0, box.y0, box.x1, box.y1);
  if (!best) return centroid(rings[0]);
  for (let round = 0; round < 4; round++) {
    const [x, y] = best.p;
    scan(x - step, y - step, x + step, y + step);
    step /= 2;
  }
  return best.p;
}

function sharedVertices(a, b, eps) {
  if (a.length === 0 || b.length === 0) return 0;
  if (a.length * b.length <= 2500) {
    let n = 0;
    for (const p of a) if (b.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= eps)) n++;
    return n;
  }
  const cell = eps;
  const grid = new Map();
  const key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (const q of b) {
    const k = key(q[0], q[1]);
    const bucket = grid.get(k);
    if (bucket) bucket.push(q);
    else grid.set(k, [q]);
  }
  let n = 0;
  for (const p of a) {
    const cx = Math.floor(p[0] / cell);
    const cy = Math.floor(p[1] / cell);
    let hit = false;
    for (let dx = -1; dx <= 1 && !hit; dx++) {
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        const bucket = grid.get(`${cx + dx},${cy + dy}`);
        if (bucket && bucket.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= eps)) hit = true;
      }
    }
    if (hit) n++;
  }
  return n;
}

function sharesEdge(a, b, eps) {
  if (a.length * b.length > 20000) return false;
  const edgeOn = (poly, other) => {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= eps * 2) continue;
      let pOn = false;
      let qOn = false;
      for (let j = 0; j < other.length; j++) {
        const s = other[j];
        const t = other[(j + 1) % other.length];
        if (!pOn && distToSeg(p, s, t) <= eps) pOn = true;
        if (!qOn && distToSeg(q, s, t) <= eps) qOn = true;
        if (pOn && qOn) return true;
      }
    }
    return false;
  };
  return edgeOn(a, b) || edgeOn(b, a);
}

function sameDomain(a, b) {
  if (boxesApart(boxOf(a), boxOf(b), VERTEX_EPS)) return false;
  return sharedVertices(a, b, VERTEX_EPS) >= 2 || sharesEdge(a, b, VERTEX_EPS);
}

function coastal(landRings, seaRings, isLand) {
  const lb = landRings.map(boxOf).reduce((a, b) => ({
    x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
  }));
  const sb = seaRings.map(boxOf).reduce((a, b) => ({
    x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
  }));
  const x0 = Math.max(lb.x0, sb.x0) - COAST_REACH;
  const y0 = Math.max(lb.y0, sb.y0) - COAST_REACH;
  const x1 = Math.min(lb.x1, sb.x1) + COAST_REACH;
  const y1 = Math.min(lb.y1, sb.y1) + COAST_REACH;
  if (x0 > x1 || y0 > y1) return false;
  const cols = Math.ceil((x1 - x0) / COAST_STEP) + 1;
  const rows = Math.ceil((y1 - y0) / COAST_STEP) + 1;
  if (cols * rows > 400000) return false;
  const landCells = [];
  const water = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = [x0 + c * COAST_STEP, y0 + r * COAST_STEP];
      if (isLand(p[0], p[1])) {
        if (landRings.some((ring) => pointInRing(p, ring))) landCells.push([r, c]);
      } else if (seaRings.some((ring) => pointInRing(p, ring))) {
        water[r * cols + c] = 1;
      }
    }
  }
  const w = Math.ceil(COAST_REACH / COAST_STEP);
  for (const [r, c] of landCells) {
    for (let dr = -w; dr <= w; dr++) {
      for (let dc = -w; dc <= w; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols || !water[rr * cols + cc]) continue;
        if (Math.hypot(dr, dc) * COAST_STEP <= COAST_REACH) return true;
      }
    }
  }
  return false;
}

const svgText = readFileSync(svgPath, "utf8");
const pathTags = [...svgText.matchAll(/<path\b([^>]*)>/g)];
let labelled = 0;
for (const tag of pathTags) {
  const attrs = tag[1];
  if (/\sid="/.test(attrs) || /inkscape:label=/.test(attrs) || /\sfill="(?!none)/.test(attrs)) labelled++;
}
const pathData = [...svgText.matchAll(/<path\b[^>]*?\sd="([^"]*)"/g)].map((m) => m[1]).filter((d) => d.trim() !== "");
const land = [];
for (const d of pathData) {
  const rings = parsePathRings(d).map(openRing).filter((r) => r.length >= 3);
  if (rings.length === 0) continue;
  if (rings.length === 1) land.push([rings[0]]);
  else land.push(...polygonClipping.xor([rings[0]], ...rings.slice(1).map((r) => [r])));
}

const bits = new Uint8Array(800 * 504);
for (const poly of land) {
  const rings = poly.map(openRing);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(503, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    const xs = [];
    for (const pts of rings) {
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > py !== yj > py) xs.push(((xj - xi) * (py - yi)) / (yj - yi) + xi);
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5));
      const to = Math.min(799, Math.ceil(xs[k + 1] - 0.5) - 1);
      for (let x = from; x <= to; x++) bits[y * 800 + x] = 1;
    }
  }
}
const isLand = (x, y) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix > 799 || iy > 503) return false;
  return bits[iy * 800 + ix] === 1;
};

const map = JSON.parse(readFileSync(mapPath, "utf8"));
const regions = Array.isArray(map.regions) ? map.regions : [];
const prepared = [];
for (const region of regions) {
  const meta = region.metadata ?? {};
  const id = String(meta.region_id ?? "");
  const sea = meta.is_sea === true || String(meta.type ?? "").toLowerCase() === "sea";
  const cutters = [region.polygon, ...(Array.isArray(region.extra_polygons) ? region.extra_polygons : [])]
    .filter((ring) => Array.isArray(ring) && ring.length >= 3)
    .map((ring) => openRing(ring.map((p) => [Number(p[0]), Number(p[1])])));
  let clipped = [];
  let clipError = "";
  if (id !== "" && cutters.length > 0) {
    try {
      const subject = cutters.map((ring) => [ring]);
      const result = sea ? polygonClipping.difference(subject, land) : polygonClipping.intersection(subject, land);
      clipped = result.map((poly) => poly.map(openRing)).filter((poly) => poly[0] && poly[0].length >= 3);
    } catch (error) {
      clipError = error instanceof Error ? error.message : String(error);
    }
  }
  const rings = clipped.map((poly) => poly[0]);
  const anchor = (Array.isArray(region.anchors) ? region.anchors : []).find((a) => a && a.type === "unit" && Number.isFinite(a.x) && Number.isFinite(a.y));
  prepared.push({ region, id, sea, clipped, rings, box: rings.length ? rings.map(boxOf).reduce((a, b) => ({
    x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
  })) : null, anchor, clipError });
}

const anchorMoves = [];
const emptyClips = [];
const clipErrors = [];
for (const item of prepared) {
  if (item.id === "") continue;
  if (item.clipError) {
    clipErrors.push(`${item.id}: ${item.clipError}`);
    continue;
  }
  if (item.rings.length === 0) {
    emptyClips.push(item.id);
    continue;
  }
  if (!item.anchor) continue;
  const at = [item.anchor.x, item.anchor.y];
  if (pointInMulti(at, item.clipped)) continue;
  const next = interiorPoint(item.clipped);
  anchorMoves.push({ id: item.id, from: [round(at[0]), round(at[1])], to: [round(next[0]), round(next[1])] });
  item.movedAnchor = next;
}

const links = new Set();
const link = (a, b) => links.add(a < b ? `${a}|${b}` : `${b}|${a}`);
for (let i = 0; i < prepared.length; i++) {
  const a = prepared[i];
  if (a.rings.length === 0) continue;
  for (let j = i + 1; j < prepared.length; j++) {
    const b = prepared[j];
    if (b.rings.length === 0) continue;
    if (a.box && b.box && boxesApart(a.box, b.box, COAST_REACH)) continue;
    let joined = false;
    if (a.sea === b.sea) {
      for (const ra of a.rings) {
        for (const rb of b.rings) {
          if (sameDomain(ra, rb)) joined = true;
        }
      }
    } else {
      const landRings = a.sea ? b.rings : a.rings;
      const seaRings = a.sea ? a.rings : b.rings;
      let share = false;
      for (const ra of landRings) {
        for (const rb of seaRings) {
          if (sharedVertices(ra, rb, VERTEX_EPS) >= 2) share = true;
        }
      }
      joined = share || coastal(landRings, seaRings, isLand);
    }
    if (joined) link(a.id, b.id);
  }
}

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const overrides = map.neighbor_overrides ?? {};
const keptAdd = [];
const keptRemove = [];
for (const pair of Array.isArray(overrides.add) ? overrides.add : []) {
  if (!Array.isArray(pair) || pair.length < 2) continue;
  link(String(pair[0]), String(pair[1]));
  keptAdd.push(pairKey(String(pair[0]), String(pair[1])));
}
for (const pair of Array.isArray(overrides.remove) ? overrides.remove : []) {
  if (!Array.isArray(pair) || pair.length < 2) continue;
  links.delete(pairKey(String(pair[0]), String(pair[1])));
  keptRemove.push(pairKey(String(pair[0]), String(pair[1])));
}

const before = new Set();
for (const region of regions) {
  const id = String(region.metadata?.region_id ?? "");
  for (const n of Array.isArray(region.neighbors) ? region.neighbors : []) {
    before.add(pairKey(id, String(n)));
  }
}
const addedLinks = [...links].filter((k) => !before.has(k)).sort();
const removedLinks = [...before].filter((k) => !links.has(k)).sort();

let unclaimed = [];
try {
  const covers = prepared.filter((item) => !item.sea && item.clipped.length > 0).map((item) => item.clipped);
  const free = covers.length === 0 ? land : polygonClipping.difference(land, ...covers);
  unclaimed = free
    .map((poly) => ({ ring: openRing(poly[0]), area: multiArea([poly]) }))
    .filter((piece) => piece.area >= MIN_UNCLAIMED)
    .sort((a, b) => b.area - a.area);
} catch (error) {
  clipErrors.push(`unclaimed land: ${error instanceof Error ? error.message : String(error)}`);
}

const known = new Set(prepared.map((item) => item.id).filter((id) => id !== ""));
const units = Array.isArray(map.starting_units) ? map.starting_units : [];
const orphanUnits = units.filter((unit) => unit && !known.has(String(unit.region_id ?? "")));

const lines = [];
lines.push(`SVG ${svgPath}`);
lines.push(`paths ${pathData.length}; path ids, inkscape:label, or fill used as a territory id: ${labelled}`);
lines.push("Sea zones are not in the SVG. They stay the polygons already stored on the map.");
lines.push(`map ${mapPath}`);
lines.push(`regions ${prepared.filter((item) => item.id).length}`);
lines.push("");
lines.push("New territory ids from the SVG: none. Paths are not named.");
lines.push("Renamed territory ids: none.");
lines.push(`Removed ids: none. ${emptyClips.length} region(s) no longer cover any of the new land or water and were left in place:`);
for (const id of emptyClips) lines.push(`  ${id}`);
lines.push("");
lines.push(`Unit pins moved back onto the new shape: ${anchorMoves.length}`);
for (const move of anchorMoves) lines.push(`  ${move.id}  ${move.from.join(",")} -> ${move.to.join(",")}`);
lines.push("");
lines.push(`Neighbor links added ${addedLinks.length}, removed ${removedLinks.length}. Manual overrides kept: add ${keptAdd.length}, remove ${keptRemove.length}.`);
if (addedLinks.length <= 40) for (const k of addedLinks) lines.push(`  + ${k.replace("|", " — ")}`);
if (removedLinks.length <= 40) for (const k of removedLinks) lines.push(`  - ${k.replace("|", " — ")}`);
lines.push("");
lines.push(`Unclaimed land (no territory covers it), pieces of area >= ${MIN_UNCLAIMED}: ${unclaimed.length}`);
for (const piece of unclaimed.slice(0, 30)) {
  const c = centroid(piece.ring);
  lines.push(`  area ${piece.area.toFixed(1)} at ${round(c[0])}, ${round(c[1])}`);
}
if (unclaimed.length > 30) lines.push(`  … ${unclaimed.length - 30} more`);
lines.push("");
lines.push(`Starting-unit rows whose region id is missing: ${orphanUnits.length}`);
for (const unit of orphanUnits) lines.push(`  ${unit.region_id} ${unit.faction_id ?? ""} ${unit.unit_type_id ?? ""} x${unit.count ?? ""}`);
if (clipErrors.length) {
  lines.push("");
  lines.push("Clip errors:");
  for (const error of clipErrors) lines.push(`  ${error}`);
}
console.log(lines.join("\n"));

if (!outPath) {
  console.log("\nNo file written. Pass --out <file> to write a copy. The source map is left as it is.");
  process.exit(0);
}

const next = structuredClone(map);
next.land_mask = "assets/ne_110m_land_FINAL_02.svg";
const byId = new Map(prepared.map((item) => [item.id, item]));
for (const region of next.regions) {
  const id = String(region.metadata?.region_id ?? "");
  const item = byId.get(id);
  if (!item) continue;
  if (item.movedAnchor && Array.isArray(region.anchors)) {
    let placed = false;
    region.anchors = region.anchors.map((anchor) => {
      if (placed || !anchor || anchor.type !== "unit") return anchor;
      placed = true;
      return { ...anchor, x: round(item.movedAnchor[0]), y: round(item.movedAnchor[1]) };
    });
  }
  const neighbors = [];
  for (const key of links) {
    const [a, b] = key.split("|");
    if (a === id) neighbors.push(b);
    else if (b === id) neighbors.push(a);
  }
  region.neighbors = neighbors.sort();
}
const text = JSON.stringify(next, null, 2).replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, "[$1, $2]");
writeFileSync(outPath, text);
console.log(`\nWrote ${outPath}`);

function round(n) {
  return Math.round(n * 100) / 100;
}
