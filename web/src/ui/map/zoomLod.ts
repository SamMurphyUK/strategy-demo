// Semantic zoom for the campaign map. Pure: the canvas only paints what this decides.
import type { Vec2 } from "./geometry";

/** 0 strategic tokens, 1 operational terrain stamps, 2 tactical upright sprites. */
export type MapLod = 0 | 1 | 2;

const OPERATIONAL = 1.35;
const TACTICAL_IN = 1.75;
const TACTICAL_OUT = 1.65;

/**
 * LoD for `zoom`. Enter the upright view at 1.75. Once there, stay until the zoom falls below 1.65.
 */
export function lodForZoom(zoom: number, previous: MapLod = 0): MapLod {
  if (zoom >= TACTICAL_IN || (previous === 2 && zoom >= TACTICAL_OUT)) {
    return 2;
  }
  if (zoom >= OPERATIONAL) {
    return 1;
  }
  return 0;
}

/** 0 at the operational threshold, 1 as the zoom reaches the upright view. */
export function terrainStampAlpha(zoom: number): number {
  if (zoom < OPERATIONAL || zoom >= TACTICAL_IN) {
    return 0;
  }
  return (zoom - OPERATIONAL) / (TACTICAL_IN - OPERATIONAL);
}

/** How far above a plinth centre a click still counts as that sprite, in screen pixels. */
export const UPRIGHT_HIT_PX = 26;

export function squadSpriteCount(count: number): number {
  if (count >= 6) {
    return 3;
  }
  if (count >= 3) {
    return 2;
  }
  return 1;
}

/** Screen-pixel offsets for a mini squad. Smaller `y` is farther from the camera and draws first. */
export function squadOffsets(count: number): { x: number; y: number }[] {
  const n = squadSpriteCount(count);
  if (n >= 3) {
    return [
      { x: -7, y: -3 },
      { x: 0, y: 0 },
      { x: 7, y: 3 },
    ];
  }
  if (n === 2) {
    return [
      { x: -5, y: -2 },
      { x: 5, y: 2 },
    ];
  }
  return [{ x: 0, y: 0 }];
}

export function sortByGroundY<T extends { worldY: number }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.worldY - b.item.worldY || a.index - b.index)
    .map((row) => row.item);
}

/** Painter's order. Below LoD 2 the list stays as it was built. */
export function uprightDrawOrder<T extends { worldY: number }>(lod: MapLod, items: readonly T[]): T[] {
  if (lod !== 2) {
    return [...items];
  }
  return sortByGroundY(items);
}

export type StampKind = "pine" | "ridge" | "dash";

export interface TerrainStamp {
  kind: StampKind;
  x: number;
  y: number;
}

export interface StampProbe {
  /** True on this territory's land, clear of the sea. */
  interior: (p: Vec2) => boolean;
  /** True in the water. */
  water: (p: Vec2) => boolean;
}

const HUB_CLEARANCE = 14;

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blocked(x: number, y: number, avoid: readonly Vec2[], existing: readonly TerrainStamp[], clearance: number): boolean {
  const limit = clearance * clearance;
  for (const point of avoid) {
    const dx = point.x - x;
    const dy = point.y - y;
    if (dx * dx + dy * dy < limit) {
      return true;
    }
  }
  for (const stamp of existing) {
    if (stamp.kind === "dash") {
      continue;
    }
    const dx = stamp.x - x;
    const dy = stamp.y - y;
    if (dx * dx + dy * dy < 36) {
      return true;
    }
  }
  return false;
}

function ringBounds(ring: readonly Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of ring) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Deterministic pines, ridges and coastal dashes for one land territory.
 * Interior marks stay off the anchor and the unit slots. Dashes sit in the water just off a coast edge.
 */
export function terrainStamps(
  regionId: string,
  rings: readonly (readonly Vec2[])[],
  avoid: readonly Vec2[],
  probe: StampProbe,
): TerrainStamp[] {
  const out: TerrainStamp[] = [];
  const usable = rings.filter((ring) => ring.length >= 3);
  if (usable.length === 0) {
    return out;
  }
  let area = 0;
  for (const ring of usable) {
    const box = ringBounds(ring);
    area += Math.max(0, box.maxX - box.minX) * Math.max(0, box.maxY - box.minY);
  }
  const quota = area > 2500 ? 5 : 3;
  const plan: Array<"pine" | "ridge"> = [];
  for (let i = 0; i < quota; i++) {
    plan.push(i === 1 ? "ridge" : "pine");
  }
  let placed = 0;
  for (const ring of usable) {
    if (placed >= plan.length) {
      break;
    }
    const box = ringBounds(ring);
    const w = box.maxX - box.minX;
    const h = box.maxY - box.minY;
    if (w < 6 || h < 6) {
      continue;
    }
    const rand = mulberry32(hashId(`${regionId}:${ring.length}:${ring[0].x.toFixed(2)}:${ring[0].y.toFixed(2)}`));
    for (let attempt = 0; attempt < 18 && placed < plan.length; attempt++) {
      const x = box.minX + w * (0.18 + rand() * 0.64);
      const y = box.minY + h * (0.18 + rand() * 0.64);
      if (!probe.interior({ x, y }) || blocked(x, y, avoid, out, HUB_CLEARANCE)) {
        continue;
      }
      out.push({ kind: plan[placed], x, y });
      placed++;
    }
  }

  const dashes: { x: number; y: number }[] = [];
  for (const ring of usable) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (Math.abs(b.x - a.x) < Math.abs(b.y - a.y) * 1.2) {
        continue;
      }
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const sides = [
        { x: midX, y: midY + 1.6, landY: midY - 0.8 },
        { x: midX, y: midY - 1.6, landY: midY + 0.8 },
      ];
      for (const side of sides) {
        if (!probe.water({ x: side.x, y: side.y })) {
          continue;
        }
        if (probe.water({ x: side.x, y: side.landY })) {
          continue;
        }
        if (blocked(side.x, side.y, avoid, out, 8)) {
          continue;
        }
        dashes.push({ x: side.x, y: side.y });
      }
    }
  }
  dashes.sort((a, b) => b.y - a.y);
  for (const dash of dashes.slice(0, 3)) {
    out.push({ kind: "dash", x: dash.x, y: dash.y });
  }
  return out;
}
