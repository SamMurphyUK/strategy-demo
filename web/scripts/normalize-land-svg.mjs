// Flatten a landmass SVG into the form the map loader can read.
//
//   npm run normalize-land-svg -- <input.svg>
//
// Writes web/public/assets/ne_110m_land_FINAL_02.svg. The loader (parsePathRings) accepts
// only M, L, H, V, Z inside <g id="ne_110m_land">, in an 800×504 viewBox. This script maps
// the source viewBox onto that rectangle, turns <polygon> and <polyline> into paths, and
// flattens cubic, quadratic, smooth, and arc commands into polylines. It does not teach
// the loader to accept curves.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const OUT_W = 800;
const OUT_H = 504;
/** Max deviation of a flattened curve from the true curve, in output pixels. */
const FLAT_TOL = 0.15;
const IDENTITY = [1, 0, 0, 1, 0, 0];

const OUT_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public/assets/ne_110m_land_FINAL_02.svg",
);

/** @param {number[]} a @param {number[]} b `b` is applied to the point first. */
function mul(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function matrixScale(m) {
  return Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]), 1e-9);
}

function parseTransform(text) {
  if (!text) {
    return IDENTITY;
  }
  let m = IDENTITY.slice();
  const re = /(matrix|translate|scale|rotate)\s*\(([^)]*)\)/gi;
  let match;
  while ((match = re.exec(text))) {
    const nums = match[2]
      .trim()
      .split(/[\s,]+/)
      .filter((part) => part !== "")
      .map(Number);
    const kind = match[1].toLowerCase();
    let local = IDENTITY;
    if (kind === "matrix" && nums.length >= 6) {
      local = nums.slice(0, 6);
    } else if (kind === "translate") {
      local = [1, 0, 0, 1, nums[0] || 0, nums[1] || 0];
    } else if (kind === "scale") {
      const sx = nums[0] || 1;
      local = [sx, 0, 0, nums.length > 1 ? nums[1] : sx, 0, 0];
    } else if (kind === "rotate") {
      const a = ((nums[0] || 0) * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      local = [cos, sin, -sin, cos, 0, 0];
      if (nums.length >= 3) {
        const cx = nums[1];
        const cy = nums[2];
        local = mul(mul([1, 0, 0, 1, cx, cy], local), [1, 0, 0, 1, -cx, -cy]);
      }
    }
    // SVG applies the list from right to left, so the newest function is applied first.
    m = mul(m, local);
  }
  return m;
}

function attr(source, name) {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const match = re.exec(source);
  return match ? (match[1] ?? match[2] ?? "") : "";
}

function parseViewBox(text, widthAttr, heightAttr) {
  const parts = String(text ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length === 4 && parts.every((n) => Number.isFinite(n)) && parts[2] > 0 && parts[3] > 0) {
    return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
  }
  const w = Number(String(widthAttr).replace(/px$/i, ""));
  const h = Number(String(heightAttr).replace(/px$/i, ""));
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { x: 0, y: 0, w, h };
  }
  return { x: 0, y: 0, w: OUT_W, h: OUT_H };
}

function tokenizePath(d) {
  const tokens = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let match;
  while ((match = re.exec(d))) {
    tokens.push(match[1] ? match[1] : Number(match[2]));
  }
  return tokens;
}

function flattenCubic(p0, p1, p2, p3, tol, out, depth = 0) {
  const dx = p3[0] - p0[0];
  const dy = p3[1] - p0[1];
  const d1 = Math.abs((p1[0] - p3[0]) * dy - (p1[1] - p3[1]) * dx);
  const d2 = Math.abs((p2[0] - p3[0]) * dy - (p2[1] - p3[1]) * dx);
  const chord = dx * dx + dy * dy;
  if (depth > 12 || (d1 + d2) * (d1 + d2) <= tol * tol * (chord || 1)) {
    out.push(p3);
    return;
  }
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const p01 = mid(p0, p1);
  const p12 = mid(p1, p2);
  const p23 = mid(p2, p3);
  const p012 = mid(p01, p12);
  const p123 = mid(p12, p23);
  const join = mid(p012, p123);
  flattenCubic(p0, p01, p012, join, tol, out, depth + 1);
  flattenCubic(join, p123, p23, p3, tol, out, depth + 1);
}

function quadToCubic(p0, p1, p2) {
  return [
    p0,
    [p0[0] + (2 / 3) * (p1[0] - p0[0]), p0[1] + (2 / 3) * (p1[1] - p0[1])],
    [p2[0] + (2 / 3) * (p1[0] - p2[0]), p2[1] + (2 / 3) * (p1[1] - p2[1])],
    p2,
  ];
}

function arcPoints(x0, y0, rx, ry, phiDeg, large, sweep, x, y, tol) {
  if (Math.hypot(x - x0, y - y0) < 1e-9) {
    return [];
  }
  let rxAbs = Math.abs(rx);
  let ryAbs = Math.abs(ry);
  if (rxAbs < 1e-9 || ryAbs < 1e-9) {
    return [[x, y]];
  }
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x0 - x) / 2;
  const dy = (y0 - y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rxAbs * rxAbs) + (y1 * y1) / (ryAbs * ryAbs);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rxAbs *= scale;
    ryAbs *= scale;
  }
  const rxSq = rxAbs * rxAbs;
  const rySq = ryAbs * ryAbs;
  const num = rxSq * rySq - rxSq * y1 * y1 - rySq * x1 * x1;
  const den = rxSq * y1 * y1 + rySq * x1 * x1;
  let coef = den <= 0 ? 0 : Math.sqrt(Math.max(0, num / den));
  if (Number(large) === Number(sweep)) {
    coef = -coef;
  }
  const cx1 = coef * ((rxAbs * y1) / ryAbs);
  const cy1 = coef * -((ryAbs * x1) / rxAbs);
  const cx = cos * cx1 - sin * cy1 + (x0 + x) / 2;
  const cy = sin * cx1 + cos * cy1 + (y0 + y) / 2;
  const angle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1;
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) {
      a = -a;
    }
    return a;
  };
  const theta1 = angle(1, 0, (x1 - cx1) / rxAbs, (y1 - cy1) / ryAbs);
  let delta = angle((x1 - cx1) / rxAbs, (y1 - cy1) / ryAbs, (-x1 - cx1) / rxAbs, (-y1 - cy1) / ryAbs);
  if (!Number(sweep) && delta > 0) {
    delta -= Math.PI * 2;
  } else if (Number(sweep) && delta < 0) {
    delta += Math.PI * 2;
  }
  const steps = Math.max(2, Math.min(1024, Math.ceil((Math.abs(delta) * Math.max(rxAbs, ryAbs)) / Math.max(tol, 1e-4))));
  const points = [];
  for (let i = 1; i <= steps; i++) {
    const t = theta1 + (delta * i) / steps;
    const ex = Math.cos(t) * rxAbs;
    const ey = Math.sin(t) * ryAbs;
    points.push([cx + cos * ex - sin * ey, cy + sin * ex + cos * ey]);
  }
  points[points.length - 1] = [x, y];
  return points;
}

/**
 * Flatten one path's `d` into subpaths of absolute user-space points.
 * @returns {{ points: number[][], closed: boolean }[]}
 */
export function flattenPathData(d, tol = FLAT_TOL) {
  const tokens = tokenizePath(d);
  const subs = [];
  let current = null;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let cmd = "";
  let lastOp = "";
  let cctrl = [0, 0];
  let qctrl = [0, 0];
  let i = 0;

  const start = (x, y) => {
    current = { points: [[x, y]], closed: false };
    subs.push(current);
    sx = x;
    sy = y;
    cx = x;
    cy = y;
  };
  const line = (x, y) => {
    if (!current) {
      start(cx, cy);
    }
    current.points.push([x, y]);
    cx = x;
    cy = y;
  };
  const reflect = (ctrl) => [2 * cx - ctrl[0], 2 * cy - ctrl[1]];

  while (i < tokens.length) {
    if (typeof tokens[i] === "string") {
      cmd = tokens[i];
      i += 1;
    } else if (cmd === "M" || cmd === "Z" || cmd === "z") {
      cmd = "L";
    } else if (cmd === "m") {
      cmd = "l";
    } else if (cmd === "") {
      throw new Error("Path data starts with a number.");
    }
    const rel = cmd === cmd.toLowerCase();
    const op = cmd.toUpperCase();
    if (op === "Z") {
      if (current && current.points.length >= 2) {
        current.closed = true;
      }
      cx = sx;
      cy = sy;
      lastOp = "Z";
      cctrl = [cx, cy];
      qctrl = [cx, cy];
      continue;
    }
    const need = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 }[op];
    if (!need) {
      throw new Error(`Unsupported path command "${cmd}".`);
    }
    if (i + need > tokens.length || tokens.slice(i, i + need).some((token) => typeof token !== "number")) {
      throw new Error(`Path command "${cmd}" is missing coordinates.`);
    }
    const n = tokens.slice(i, i + need);
    i += need;
    const abs = (x, y) => (rel ? [x + cx, y + cy] : [x, y]);
    if (op === "M") {
      const [x, y] = abs(n[0], n[1]);
      start(x, y);
      cctrl = [cx, cy];
      qctrl = [cx, cy];
    } else if (op === "L") {
      const [x, y] = abs(n[0], n[1]);
      line(x, y);
      cctrl = [cx, cy];
      qctrl = [cx, cy];
    } else if (op === "H") {
      line(rel ? cx + n[0] : n[0], cy);
      cctrl = [cx, cy];
      qctrl = [cx, cy];
    } else if (op === "V") {
      line(cx, rel ? cy + n[0] : n[0]);
      cctrl = [cx, cy];
      qctrl = [cx, cy];
    } else if (op === "C") {
      const p1 = abs(n[0], n[1]);
      const p2 = abs(n[2], n[3]);
      const p3 = abs(n[4], n[5]);
      const extra = [];
      flattenCubic([cx, cy], p1, p2, p3, tol, extra);
      for (const p of extra) {
        line(p[0], p[1]);
      }
      cctrl = p2;
      qctrl = [cx, cy];
    } else if (op === "S") {
      const p1 = lastOp === "C" || lastOp === "S" ? reflect(cctrl) : [cx, cy];
      const p2 = abs(n[0], n[1]);
      const p3 = abs(n[2], n[3]);
      const extra = [];
      flattenCubic([cx, cy], p1, p2, p3, tol, extra);
      for (const p of extra) {
        line(p[0], p[1]);
      }
      cctrl = p2;
      qctrl = [cx, cy];
    } else if (op === "Q" || op === "T") {
      const p1 = op === "T" ? (lastOp === "Q" || lastOp === "T" ? reflect(qctrl) : [cx, cy]) : abs(n[0], n[1]);
      const p2 = op === "T" ? abs(n[0], n[1]) : abs(n[2], n[3]);
      const [a, b, c, d] = quadToCubic([cx, cy], p1, p2);
      const extra = [];
      flattenCubic(a, b, c, d, tol, extra);
      for (const p of extra) {
        line(p[0], p[1]);
      }
      qctrl = p1;
      cctrl = [cx, cy];
    } else if (op === "A") {
      const end = abs(n[5], n[6]);
      for (const p of arcPoints(cx, cy, n[0], n[1], n[2], n[3], n[4], end[0], end[1], tol)) {
        line(p[0], p[1]);
      }
      cctrl = [cx, cy];
      qctrl = [cx, cy];
    }
    lastOp = op;
  }
  return subs;
}

function parsePoints(text) {
  const nums = String(text)
    .trim()
    .split(/[\s,]+/)
    .filter((part) => part !== "")
    .map(Number);
  const points = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    if (Number.isFinite(nums[i]) && Number.isFinite(nums[i + 1])) {
      points.push([nums[i], nums[i + 1]]);
    }
  }
  return points;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function samePoint(a, b) {
  return Math.abs(a[0] - b[0]) < 0.005 && Math.abs(a[1] - b[1]) < 0.005;
}

function emitSubpath(points, closed) {
  const rounded = [];
  for (const p of points) {
    const next = [round2(p[0]), round2(p[1])];
    if (rounded.length === 0 || !samePoint(rounded[rounded.length - 1], next)) {
      rounded.push(next);
    }
  }
  if (closed && rounded.length >= 2 && samePoint(rounded[0], rounded[rounded.length - 1])) {
    rounded.pop();
  }
  if (rounded.length < (closed ? 3 : 2)) {
    return "";
  }
  const body = rounded.map((p, index) => `${index === 0 ? "M" : "L"} ${fmt(p[0])} ${fmt(p[1])}`).join(" ");
  return closed ? `${body} Z` : body;
}

function collectShapes(svg) {
  const cleaned = svg.replace(/<!DOCTYPE[\s\S]*?>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  const re = /<(\/?)([A-Za-z][\w:.-]*)\b([^>]*)>/g;
  const stack = [{ matrix: IDENTITY.slice(), skip: false }];
  const shapes = [];
  let viewBox = "";
  let width = "";
  let height = "";
  let match;
  while ((match = re.exec(cleaned))) {
    const closing = match[1] === "/";
    const name = match[2].toLowerCase().replace(/^svg:/, "");
    const rawAttrs = match[3] ?? "";
    const self = /\/\s*$/.test(rawAttrs);
    if (closing) {
      if (stack.length > 1) {
        stack.pop();
      }
      continue;
    }
    const parent = stack[stack.length - 1];
    const matrix = mul(parent.matrix, parseTransform(attr(rawAttrs, "transform")));
    const skipHere = name === "defs" || name === "clippath" || name === "mask" || name === "symbol" || name === "marker";
    const skip = parent.skip || skipHere;
    if (name === "svg" && viewBox === "" && width === "" && height === "") {
      viewBox = attr(rawAttrs, "viewBox");
      width = attr(rawAttrs, "width");
      height = attr(rawAttrs, "height");
    }
    if (!skip) {
      if (name === "path") {
        const d = attr(rawAttrs, "d");
        if (d.trim() !== "") {
          shapes.push({ kind: "path", d, matrix });
        }
      } else if (name === "polygon" || name === "polyline") {
        const points = attr(rawAttrs, "points");
        if (points.trim() !== "") {
          shapes.push({ kind: name, points, matrix });
        }
      }
    }
    if (!self) {
      stack.push({ matrix, skip });
    }
  }
  return { shapes, viewBox: parseViewBox(viewBox, width, height) };
}

function fmt(n) {
  const rounded = round2(n);
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/**
 * @param {string} svg
 * @returns {{ svg: string, paths: number, curves: number, polygons: number, polylines: number }}
 */
export function normalizeLandSvg(svg) {
  const { shapes, viewBox } = collectShapes(svg);
  const view = [OUT_W / viewBox.w, 0, 0, OUT_H / viewBox.h, (-viewBox.x * OUT_W) / viewBox.w, (-viewBox.y * OUT_H) / viewBox.h];
  const commands = [];
  let curves = 0;
  let polygons = 0;
  let polylines = 0;
  for (const shape of shapes) {
    const tf = mul(view, shape.matrix);
    const tol = FLAT_TOL / matrixScale(tf);
    /** @type {{ points: number[][], closed: boolean }[]} */
    let subs = [];
    if (shape.kind === "path") {
      if (/[CcSsQqTtAa]/.test(shape.d)) {
        curves += 1;
      }
      subs = flattenPathData(shape.d, tol);
    } else {
      const points = parsePoints(shape.points);
      if (points.length >= 2) {
        const closed = shape.kind === "polygon" || samePoint(points[0], points[points.length - 1]);
        subs = [{ points, closed }];
        if (shape.kind === "polygon") {
          polygons += 1;
        } else {
          polylines += 1;
        }
      }
    }
    const parts = [];
    for (const sub of subs) {
      const mapped = sub.points.map((p) => apply(tf, p[0], p[1]));
      const emitted = emitSubpath(mapped, sub.closed);
      if (emitted !== "") {
        parts.push(emitted);
      }
    }
    if (parts.length > 0) {
      commands.push(parts.join(" "));
    }
  }
  if (commands.length === 0) {
    throw new Error("The SVG has no path, polygon, or polyline geometry to flatten.");
  }
  const body = commands.map((d) => `<path d="${d}"/>`).join("\n");
  const out = `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" version="1.2" width="${OUT_W}" height="${OUT_H}" viewBox="0 0 ${OUT_W} ${OUT_H}">\n<g id="ne_110m_land">\n${body}\n</g>\n</svg>\n`;
  return { svg: out, paths: commands.length, curves, polygons, polylines };
}

async function main() {
  const input = process.argv[2];
  if (!input || input.startsWith("-")) {
    console.error("Usage: npm run normalize-land-svg -- <input.svg>");
    process.exit(1);
  }
  const source = await readFile(path.resolve(input), "utf8");
  const result = normalizeLandSvg(source);
  await writeFile(OUT_FILE, result.svg, "utf8");
  console.log(
    `Wrote ${path.relative(process.cwd(), OUT_FILE)} (${result.paths} paths, ${result.curves} curved, ${result.polygons} polygons, ${result.polylines} polylines) at viewBox 0 0 ${OUT_W} ${OUT_H}.`,
  );
}

const invoked = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
