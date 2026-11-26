// What a battle is fought on, and where the scatter stands. Pure: no Three.js, no combat state.
//
// `terrainFor` reads the territory (the scene the battle screen already has, its name, its theatre) and says plains, bocage,
// urban or mountain. `planScatter` turns a skin's scatter mapping for that terrain into pieces on the stage, seeded by the
// territory so the same battle always stands on the same ground. The stage never asks what a piece is for.
import type { BattleSkin, BattleTerrain, ScatterRule, ScatterSet, ScatterZone } from "../skins/battleSkin";
import { STAGE_HALF } from "./battleLanes";

export interface TerrainInput {
  regionId?: string;
  regionName?: string;
  theater?: string;
  /** The battle screen's scene for the region, when it has one. Only the fields read here. */
  scene?: { kind: string; biome?: string; culture?: string; settlement?: string; landmarks?: readonly string[] } | null;
}

/** The city landmarks a battle stage can raise behind the lines, by the territory they stand in. */
const LANDMARK_BY_REGION: Readonly<Record<string, string>> = Object.freeze({
  germany: "berlin",
  berlin: "berlin",
  france: "paris",
  paris: "paris",
  "united kingdom": "london",
  london: "london",
  italy: "rome",
  rome: "rome",
  moscow: "moscow",
  petersburgh: "leningrad",
  leningrad: "leningrad",
  volgads: "stalingrad",
  stalingrad: "stalingrad",
});

export const STAGE_LANDMARKS: readonly string[] = ["london", "paris", "berlin", "rome", "moscow", "leningrad", "stalingrad"];

/** The landmark for a territory, or null. Matches the region id or its name, case-insensitively. */
export function landmarkFor(input: Pick<TerrainInput, "regionId" | "regionName">): string | null {
  for (const raw of [input.regionId, input.regionName]) {
    const hit = raw ? LANDMARK_BY_REGION[raw.trim().toLowerCase()] : undefined;
    if (hit) {
      return hit;
    }
  }
  return null;
}

const MOUNTAIN = /\b(alps?|swiss|switzerland|austria|yugoslavia|caucus|caucasus|carpathian|norway|ural|pyrenees|tibet|himalaya)/i;
const BOCAGE = /\b(norman|normandy|france|netherlands|belgium|brittany|western europe|eire|bocage)/i;

/** What kind of ground the territory is. A city landmark makes it urban; otherwise its name and its scene decide. */
export function terrainFor(input: TerrainInput): BattleTerrain {
  const name = `${input.regionId ?? ""} ${input.regionName ?? ""}`;
  if (landmarkFor(input)) {
    return "urban";
  }
  const scene = input.scene;
  if (scene?.kind === "land" && (scene.settlement === "capital" || scene.settlement === "city")) {
    return "urban";
  }
  if (MOUNTAIN.test(name)) {
    return "mountain";
  }
  if (BOCAGE.test(name) || input.theater === "normandy") {
    return "bocage";
  }
  if (scene?.kind === "land" && scene.biome === "temperate" && (scene.culture === "western" || scene.culture === "british")) {
    return "bocage";
  }
  return "plains";
}

/** How many variants each set has in the manifest. */
export const SCATTER_VARIANTS: Readonly<Record<ScatterSet, number>> = Object.freeze({
  sandbag_bunker: 2,
  trench_parapet: 2,
  wire_obstacles: 2,
  anti_tank_obstacles: 3,
  hedgerow_segments: 3,
  pastoral_trees: 3,
  nash_shattered_trees: 3,
  ruined_masonry: 3,
  field_props: 3,
  shell_craters: 3,
});

export interface ScatterPiece {
  set: ScatterSet;
  variant: number;
  zone: ScatterZone;
  /** Stage x and depth fraction. */
  x: number;
  d: number;
  scale: number;
  flip: boolean;
}

export interface Keepout {
  x: number;
  d: number;
  /** In stage units. */
  r: number;
}

/** A small seeded generator: the same territory dresses the same way every time. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The rectangle of the stage a zone's pieces may stand in: |x| from `near` to `far` on either side, d from `from` to `to`. */
export function zoneBounds(zone: ScatterZone, set: ScatterSet): { near: number; far: number; from: number; to: number } {
  if (zone === "verge") {
    return { near: 0, far: STAGE_HALF - 0.6, from: 0.04, to: 0.11 };
  }
  if (zone === "midground") {
    return { near: 0, far: STAGE_HALF - 0.6, from: 0.7, to: 0.94 };
  }
  // Cover: obstacles stand out in no-man's land, works stand behind the front rank.
  if (set === "wire_obstacles" || set === "anti_tank_obstacles") {
    return { near: 0.5, far: 2.1, from: 0.14, to: 0.5 };
  }
  return { near: 2.4, far: 7.6, from: 0.4, to: 0.5 };
}

/** The Nth piece, drawn from `zone`'s rectangle. */
function drawPoint(zone: ScatterZone, set: ScatterSet, rng: () => number): { x: number; d: number } {
  const b = zoneBounds(zone, set);
  const side = rng() < 0.5 ? -1 : 1;
  const x = zone === "cover" ? side * (b.near + rng() * (b.far - b.near)) : (rng() * 2 - 1) * b.far;
  return { x, d: b.from + rng() * (b.to - b.from) };
}

/** Whether a piece of the plan is allowed in the terrain. Masonry stands in towns and cities only. */
export function setAllowed(skin: Pick<BattleSkin, "urbanOnly">, set: ScatterSet, terrain: BattleTerrain): boolean {
  return terrain === "urban" || !skin.urbanOnly.includes(set);
}

/**
 * The scatter for a battle. `density` is battleScatterDensity: 0 is bare ground, 1 is the skin's plan, 2 half again as thick (counts
 * scale by 1.5 at the top of the slider). Pieces keep clear of `keepouts` (the units' slots, the landmark's plinth) and of each other.
 */
export function planScatter(
  skin: Pick<BattleSkin, "scatter" | "urbanOnly">,
  terrain: BattleTerrain,
  density: number,
  seed: number,
  keepouts: readonly Keepout[] = [],
): ScatterPiece[] {
  const rng = seeded(seed ^ hashString(terrain));
  const k = density <= 1 ? Math.max(0, density) : 1 + (density - 1) * 0.5;
  const placed: ScatterPiece[] = [];
  const rules: readonly ScatterRule[] = skin.scatter[terrain];
  for (const rule of rules) {
    if (!setAllowed(skin, rule.set, terrain)) {
      continue;
    }
    const want = Math.round(rule.count * k);
    let made = 0;
    for (let tries = 0; made < want && tries < want * 40; tries++) {
      const p = drawPoint(rule.zone, rule.set, rng);
      const clear = rule.zone === "cover" ? 0.42 : 0.5;
      if (keepouts.some((o) => Math.hypot(o.x - p.x, (o.d - p.d) * 10) < o.r)) {
        continue;
      }
      if (placed.some((q) => Math.hypot(q.x - p.x, (q.d - p.d) * 10) < clear)) {
        continue;
      }
      placed.push({
        set: rule.set,
        variant: 1 + Math.floor(rng() * SCATTER_VARIANTS[rule.set]),
        zone: rule.zone,
        x: p.x,
        d: p.d,
        scale: 0.88 + rng() * 0.26,
        flip: rng() < 0.5,
      });
      made++;
    }
  }
  // Far pieces first: the stage draws them in this order, so nearer ones overlap them.
  return placed.sort((a, b) => b.d - a.d);
}
