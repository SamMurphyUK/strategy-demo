// DOM-free helpers for the master land SVG. The loader (svgLandLoader.ts) does the fetch and Path2D work.
import type { Rect } from "./geometry";

/** The land SVG's viewBox is the map's world space: region polygons and anchors use the same units. */
export function parseViewBox(viewBox: string | null | undefined, width = 0, height = 0): Rect {
  const nums = String(viewBox ?? "")
    .split(/[\s,]+/)
    .filter((s) => s !== "")
    .map(Number);
  if (nums.length === 4 && nums.every(Number.isFinite) && nums[2] > 0 && nums[3] > 0) {
    return { x: nums[0], y: nums[1], w: nums[2], h: nums[3] };
  }
  return { x: 0, y: 0, w: width > 0 ? width : 1, h: height > 0 ? height : 1 };
}

/** Every `d` attribute of every <path> in the SVG text. Pure, so tests and scripts can read the file directly. */
export function extractPathData(svgText: string): string[] {
  const out: string[] = [];
  for (const match of svgText.matchAll(/<path\b[^>]*?\sd="([^"]*)"/g)) {
    if (match[1].trim() !== "") {
      out.push(match[1]);
    }
  }
  return out;
}

/** The file's fill-rule. SVG's own default is nonzero when the file never says. */
export function fillRuleOf(svgText: string): "nonzero" | "evenodd" {
  const match = /fill-rule\s*=\s*["'](nonzero|evenodd)["']/i.exec(svgText);
  return match !== null && match[1].toLowerCase() === "evenodd" ? "evenodd" : "nonzero";
}

/** Straight-line spacing used when an Inkscape cubic is turned into the coast's polygon. */
const CURVE_STEP = 0.8;

function curvePoint(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  t: number,
): [number, number] {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

/**
 * The closed rings of one path's data, one per sub-path. The stored coast is straight segments only
 * (M, L, H, V, Z, absolute or relative, with implicit lineto). A cubic is accepted only while an
 * imported SVG is being flattened; anything else is an error rather than a quiet misread.
 */
function readRings(d: string, curves: boolean): [number, number][][] {
  const rings: [number, number][][] = [];
  const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  let ring: [number, number][] = [];
  let cmd = "";
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let i = 0;
  const num = (): number => {
    const v = Number(tokens[i++]);
    if (!Number.isFinite(v)) {
      throw new Error(`Bad number in path data near token ${i}`);
    }
    return v;
  };
  const flush = () => {
    if (ring.length >= 3) {
      rings.push(ring);
    }
    ring = [];
  };
  const isCmd = (t: string | undefined) => t !== undefined && /^[A-Za-z]$/.test(t);
  const push = (px: number, py: number) => {
    const last = ring[ring.length - 1];
    if (last && Math.abs(last[0] - px) < 0.05 && Math.abs(last[1] - py) < 0.05) {
      return;
    }
    ring.push([px, py]);
  };

  while (i < tokens.length) {
    if (isCmd(tokens[i])) {
      cmd = tokens[i++];
    } else if (cmd === "") {
      throw new Error("Path data must start with a command");
    }
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case "M": {
        flush();
        const nx = num();
        const ny = num();
        x = rel ? x + nx : nx;
        y = rel ? y + ny : ny;
        startX = x;
        startY = y;
        ring.push([x, y]);
        cmd = rel ? "l" : "L"; // extra pairs after M are lineto
        break;
      }
      case "L": {
        const nx = num();
        const ny = num();
        x = rel ? x + nx : nx;
        y = rel ? y + ny : ny;
        push(x, y);
        break;
      }
      case "H": {
        const nx = num();
        x = rel ? x + nx : nx;
        push(x, y);
        break;
      }
      case "V": {
        const ny = num();
        y = rel ? y + ny : ny;
        push(x, y);
        break;
      }
      case "C": {
        if (!curves) {
          throw new Error(`Unsupported path command "${cmd}" in the land SVG`);
        }
        const ax = num();
        const ay = num();
        const bx = num();
        const by = num();
        const ex = num();
        const ey = num();
        const p0: [number, number] = [x, y];
        const p1: [number, number] = rel ? [x + ax, y + ay] : [ax, ay];
        const p2: [number, number] = rel ? [x + bx, y + by] : [bx, by];
        const p3: [number, number] = rel ? [x + ex, y + ey] : [ex, ey];
        const span =
          Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) +
          Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) +
          Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
        const steps = Math.max(1, Math.ceil(span / CURVE_STEP));
        for (let s = 1; s <= steps; s++) {
          const [px, py] = curvePoint(p0, p1, p2, p3, s / steps);
          push(px, py);
        }
        x = p3[0];
        y = p3[1];
        break;
      }
      case "Z":
        flush();
        x = startX;
        y = startY;
        cmd = ""; // numbers after Z with no new command are malformed
        break;
      default:
        throw new Error(`Unsupported path command "${cmd}" in the land SVG`);
    }
  }
  flush();
  return rings;
}

/** The closed rings of one path. Curves are refused here; flatten them before calling this. */
export function parsePathRings(d: string): [number, number][][] {
  return readRings(d, false);
}

function pathFromRings(rings: [number, number][][]): string {
  return rings
    .map((ring) => {
      const body = ring.map(([px, py], index) => `${index === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`).join(" ");
      return `${body} Z`;
    })
    .join(" ");
}

/** SVG user-space matrix: x' = a x + c y + e, y' = b x + d y + f. */
interface SvgMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const IDENTITY: SvgMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function multiply(left: SvgMatrix, right: SvgMatrix): SvgMatrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function isIdentity(m: SvgMatrix): boolean {
  return (
    Math.abs(m.a - 1) < 1e-9 &&
    Math.abs(m.d - 1) < 1e-9 &&
    Math.abs(m.b) < 1e-9 &&
    Math.abs(m.c) < 1e-9 &&
    Math.abs(m.e) < 1e-9 &&
    Math.abs(m.f) < 1e-9
  );
}

function applyMatrix(m: SvgMatrix, x: number, y: number): [number, number] {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}

/** One transform function. The list itself is folded separately, rightmost closest to the point. */
function transformFunction(name: string, args: number[]): SvgMatrix {
  const n = name.toLowerCase();
  if (n === "matrix" && args.length === 6) {
    return { a: args[0], b: args[1], c: args[2], d: args[3], e: args[4], f: args[5] };
  }
  if (n === "translate") {
    return { a: 1, b: 0, c: 0, d: 1, e: args[0] ?? 0, f: args[1] ?? 0 };
  }
  if (n === "scale") {
    const sx = args[0] ?? 1;
    const sy = args[1] ?? sx;
    return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
  }
  if (n === "rotate") {
    const rad = ((args[0] ?? 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rot: SvgMatrix = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
    if (args.length >= 3) {
      const cx = args[1];
      const cy = args[2];
      return multiply(multiply({ a: 1, b: 0, c: 0, d: 1, e: cx, f: cy }, rot), { a: 1, b: 0, c: 0, d: 1, e: -cx, f: -cy });
    }
    return rot;
  }
  if (n === "skewx") {
    return { a: 1, b: 0, c: Math.tan(((args[0] ?? 0) * Math.PI) / 180), d: 1, e: 0, f: 0 };
  }
  if (n === "skewy") {
    return { a: 1, b: Math.tan(((args[0] ?? 0) * Math.PI) / 180), c: 0, d: 1, e: 0, f: 0 };
  }
  throw new Error(`Unsupported SVG transform "${name}" in the land SVG`);
}

/** The transform attribute, as one matrix. An empty attribute is the identity. */
function parseTransform(value: string | undefined): SvgMatrix {
  if (!value || value.trim() === "") {
    return IDENTITY;
  }
  let m = IDENTITY;
  for (const part of value.matchAll(/([A-Za-z]+)\s*\(([^)]*)\)/g)) {
    const args = (part[2].match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    m = multiply(m, transformFunction(part[1], args));
  }
  return m;
}

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i"));
  return match?.[1];
}

function withoutTransform(tag: string): string {
  return tag.replace(/\s*transform\s*=\s*"[^"]*"/i, "");
}

/**
 * Turn cubic segments into straight coast lines, and bake Inkscape transforms into those lines.
 * The coast reader has no transform stack, so a translated or rotated path would otherwise be
 * drawn where its raw coordinates sit. Paths that are already lines, with no transform, are left
 * unchanged. Arcs and quadratic curves are still refused by the reader.
 */
export function flattenLandSvg(svgText: string): string {
  const hasTransform = /transform\s*=/.test(svgText);
  if (!hasTransform) {
    return svgText.replace(/\sd="([^"]*)"/g, (full, d: string) => {
      if (!/[Cc]/.test(d)) {
        return full;
      }
      return ` d="${pathFromRings(readRings(d, true))}"`;
    });
  }

  const stack: SvgMatrix[] = [IDENTITY];
  let out = "";
  let last = 0;
  const tags = /<\/([A-Za-z][\w:.-]*)\s*>|<([A-Za-z][\w:.-]*)\b([^>]*)>/g;
  for (const match of svgText.matchAll(tags)) {
    const index = match.index ?? 0;
    out += svgText.slice(last, index);
    const closing = match[1];
    if (closing) {
      if (stack.length > 1 && closing.toLowerCase() !== "path") {
        stack.pop();
      }
      out += match[0];
    } else {
      const name = (match[2] ?? "").toLowerCase();
      const tag = match[0];
      const selfClosing = /\/\s*$/.test(match[3] ?? "");
      if (name === "path") {
        const d = attr(tag, "d") ?? "";
        const matrix = multiply(stack[stack.length - 1], parseTransform(attr(tag, "transform")));
        let next = withoutTransform(tag);
        if (d.trim() !== "" && (!isIdentity(matrix) || /[Cc]/.test(d))) {
          const rings = readRings(d, true).map((ring) => ring.map(([x, y]) => applyMatrix(matrix, x, y)));
          next = next.replace(/\sd="[^"]*"/i, ` d="${pathFromRings(rings)}"`);
        }
        out += next;
      } else {
        if (!selfClosing) {
          stack.push(multiply(stack[stack.length - 1], parseTransform(attr(tag, "transform"))));
        }
        out += withoutTransform(tag);
      }
    }
    last = index + match[0].length;
  }
  out += svgText.slice(last);
  return out;
}

/** One SVG path string out of many. Each sub-path starts with its own M, so a space join is safe. */
export function combinePathData(data: string[]): string {
  return data
    .map((d) => d.trim())
    .filter((d) => d !== "")
    .join(" ");
}
