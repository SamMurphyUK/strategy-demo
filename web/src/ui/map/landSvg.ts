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

/**
 * The closed rings of one path's data, one per sub-path. The land SVG is straight segments only
 * (M, L, H, V, Z, absolute or relative, with implicit lineto), so anything else is an error rather
 * than a quiet misread of the coastline.
 */
export function parsePathRings(d: string): [number, number][][] {
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
        ring.push([x, y]);
        break;
      }
      case "H": {
        const nx = num();
        x = rel ? x + nx : nx;
        ring.push([x, y]);
        break;
      }
      case "V": {
        const ny = num();
        y = rel ? y + ny : ny;
        ring.push([x, y]);
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

/** One SVG path string out of many. Each sub-path starts with its own M, so a space join is safe. */
export function combinePathData(data: string[]): string {
  return data
    .map((d) => d.trim())
    .filter((d) => d !== "")
    .join(" ");
}
