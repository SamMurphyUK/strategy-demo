// Board regions as scene inputs, read from the shared map file.
import { regions as mapRegions } from "../../../../../demomap01.json";
import { regionScene, type RegionScene, type SceneRegion } from "./regionScene";

interface MapRegion {
  metadata?: Record<string, unknown>;
  anchors?: { x?: number; y?: number }[];
  polygon?: number[][];
  neighbors?: string[];
}

function anchorOf(region: MapRegion): { x: number; y: number } | undefined {
  const first = region.anchors?.[0];
  if (first && typeof first.x === "number" && typeof first.y === "number") return { x: first.x, y: first.y };
  const ring = region.polygon ?? [];
  if (ring.length === 0) return undefined;
  const x = ring.reduce((sum, p) => sum + p[0], 0) / ring.length;
  const y = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
  return { x, y };
}

function toSceneRegion(region: MapRegion): SceneRegion {
  const meta = region.metadata ?? {};
  const id = String(meta.region_id ?? meta.name ?? "");
  return {
    id,
    name: String(meta.name ?? id),
    type: meta.is_sea || meta.type === "sea" ? "sea" : "land",
    adjacent: (region.neighbors ?? []).map(String),
    isCapital: Boolean(meta.victory ?? false),
    hasFactory: Boolean(meta.factory ?? false),
    ipc: Number(meta.ipc ?? 0),
    anchor: anchorOf(region),
  };
}

const REGIONS: SceneRegion[] = ((mapRegions ?? []) as MapRegion[]).map(toSceneRegion);
const BY_ID = new Map(REGIONS.map((r) => [r.id, r]));

/** Every board region, land first, each group alphabetical. */
export function sceneRegionList(): SceneRegion[] {
  return [...REGIONS].sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === "land" ? -1 : 1,
  );
}

/** The battle backdrop for a board region, or null if the id is not on the board. */
export function sceneForRegion(regionId: string): RegionScene | null {
  const region = BY_ID.get(regionId);
  return region ? regionScene(region, (id) => BY_ID.get(id)) : null;
}
