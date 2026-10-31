// The Tri-Wedge facility badge: one trapezoid made of three triangles that share edges.
//
//        left ▼         centre ▲         right ▼
//     (airbase)       (factory)       (harbour)
//
//   (0,0)────(s,0)────(2s,0)          the long edge is on top; the ▲ touches it at one point
//      \   /   \   /
//     (s/2,h)────(3s/2,h)             the short edge is at the bottom
//
// Pure geometry, no canvas. The renderer in mapRenderer.ts paints these shapes and their silhouettes.
import type { Facilities, Vec2 } from "./geometry";

export type BadgeSlot = "airbase" | "factory" | "harbour";

export const BADGE_FILL: Record<BadgeSlot, string> = {
  airbase: "#B87B52",
  factory: "#B5B5B5",
  harbour: "#87CEEB",
};
export const BADGE_INK = "#1A1815";
/** The outline of a slot with no facility, drawn only when the badge has two or more. */
export const BADGE_INACTIVE_STROKE = "rgba(26,24,21,0.18)";

/** Height of an equilateral triangle with side 1. */
const H = Math.sqrt(3) / 2;

export interface BadgeShape {
  slot: BadgeSlot;
  /** Triangle corners, centred on the badge's anchor, in units of one triangle side. */
  points: [Vec2, Vec2, Vec2];
  active: boolean;
  /** The ▲ points up, the ▼ ones point down. */
  pointsUp: boolean;
}

/** How many of the three facilities a region has. */
export function facilityCount(f: Facilities): number {
  return (f.factory !== "none" ? 1 : 0) + (f.airbase ? 1 : 0) + (f.harbour ? 1 : 0);
}

/** One chimney for a minor factory, two for a major one, none otherwise. */
export function chimneyCount(size: Facilities["factory"]): 0 | 1 | 2 {
  return size === "major" ? 2 : size === "minor" ? 1 : 0;
}

// The full trapezoid, side 1, from (0,0) to (2,H).
const FULL: Record<BadgeSlot, { points: [Vec2, Vec2, Vec2]; pointsUp: boolean }> = {
  airbase: {
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0.5, y: H },
    ],
    pointsUp: false,
  },
  factory: {
    points: [
      { x: 0.5, y: H },
      { x: 1.5, y: H },
      { x: 1, y: 0 },
    ],
    pointsUp: true,
  },
  harbour: {
    points: [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 1.5, y: H },
    ],
    pointsUp: false,
  },
};

const SLOT_ORDER: readonly BadgeSlot[] = ["airbase", "factory", "harbour"];

function isActive(slot: BadgeSlot, f: Facilities): boolean {
  return slot === "airbase" ? f.airbase : slot === "harbour" ? f.harbour : f.factory !== "none";
}

/**
 * The triangles to draw for a region, centred on (0, 0) and measured in triangle sides.
 *
 *  - No facility: nothing.
 *  - One facility: only its own triangle.
 *  - Two or more: all three, so the trapezoid locks together; the ones without a facility are `active: false`
 *    and are drawn as faint outlines.
 *
 * Facilities are never folded into unit stacks; this is the only place they appear.
 */
export function badgeShapes(f: Facilities): BadgeShape[] {
  const count = facilityCount(f);
  if (count === 0) {
    return [];
  }
  const slots = SLOT_ORDER.filter((slot) => count >= 2 || isActive(slot, f));
  const corners = slots.flatMap((slot) => FULL[slot].points);
  const minX = Math.min(...corners.map((p) => p.x));
  const maxX = Math.max(...corners.map((p) => p.x));
  const minY = Math.min(...corners.map((p) => p.y));
  const maxY = Math.max(...corners.map((p) => p.y));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return slots.map((slot) => {
    const { points, pointsUp } = FULL[slot];
    return {
      slot,
      pointsUp,
      active: isActive(slot, f),
      points: points.map((p) => ({ x: p.x - cx, y: p.y - cy })) as BadgeShape["points"],
    };
  });
}

/** The width and height of the drawn badge, in triangle sides. */
export function badgeExtent(f: Facilities): { w: number; h: number } {
  const shapes = badgeShapes(f);
  if (shapes.length === 0) {
    return { w: 0, h: 0 };
  }
  const xs = shapes.flatMap((s) => s.points.map((p) => p.x));
  const ys = shapes.flatMap((s) => s.points.map((p) => p.y));
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** Where a slot's silhouette sits inside its triangle, and how big it may be. Triangle sides. */
export function silhouetteBox(shape: BadgeShape): { centre: Vec2; size: number } {
  const [a, b, c] = shape.points;
  const cx = (a.x + b.x + c.x) / 3;
  const cy = (a.y + b.y + c.y) / 3;
  // `size` is the half-extent of the silhouette's -1..1 box. Nudged toward the wide side so it stays inside.
  return { centre: { x: cx, y: cy + (shape.pointsUp ? 0.04 : -0.02) }, size: 0.24 };
}

/**
 * A top-down airplane, nose up, in a -1..1 box. Listed for the right half and mirrored by planePolygon, so it
 * is symmetric by construction.
 */
const PLANE_RIGHT: Vec2[] = [
  { x: 0, y: -1 },
  { x: 0.13, y: -0.72 },
  { x: 0.15, y: -0.3 },
  { x: 1, y: 0.22 },
  { x: 1, y: 0.44 },
  { x: 0.15, y: 0.2 },
  { x: 0.12, y: 0.68 },
  { x: 0.46, y: 0.9 },
  { x: 0.46, y: 1 },
  { x: 0, y: 0.9 },
];

export function planePolygon(): Vec2[] {
  const right = PLANE_RIGHT;
  const left = [...right].slice(1, -1).reverse().map((p) => ({ x: -p.x, y: p.y }));
  return [...right, ...left];
}

/** The factory silhouette in a -1..1 box: a low hall with a sawtooth roof, and its chimneys. */
export function factoryParts(size: Facilities["factory"]): { hall: Vec2[]; chimneys: { x: number; y0: number; y1: number; w: number }[] } {
  const chimneys = chimneyCount(size);
  const xs = chimneys === 2 ? [-0.5, 0.18] : chimneys === 1 ? [-0.35] : [];
  return {
    hall: [
      { x: -0.9, y: 1 },
      { x: -0.9, y: 0.05 },
      { x: -0.3, y: 0.4 },
      { x: -0.3, y: 0.05 },
      { x: 0.3, y: 0.4 },
      { x: 0.3, y: 0.05 },
      { x: 0.9, y: 0.4 },
      { x: 0.9, y: 1 },
    ],
    chimneys: xs.map((x) => ({ x, y0: 0.1, y1: -0.8, w: 0.26 })),
  };
}
