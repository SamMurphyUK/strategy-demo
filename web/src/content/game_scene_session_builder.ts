// Port of scripts/GameSceneSessionBuilder.gd: turns editor map JSON (demomap01.json)
// into map/factions/setup dictionaries. This is content import, not a game rule.
import type { Dict } from "../engine/model/types";

export const NEWMAP_PATH = "res://demomap01.json";
export const UNITS_PATH = "res://data/scenarios/minimal/units.json";
export const RULES_PATH = "res://data/scenarios/minimal/rules.json";

export const PLAYABLE_FACTIONS = ["ussr", "ger", "uk", "jap", "usa"];
/** Classic 1942 order: Soviet Union, Germany, United Kingdom, Japan, United States. */
export const TURN_ORDER = ["ussr", "ger", "uk", "jap", "usa"] as const;
const FACTION_DISPLAY: Record<string, string> = {
  Allies: "allies",
  Axis: "axis",
  USSR: "ussr",
  GER: "ger",
  UK: "uk",
  USA: "usa",
  JAP: "jap",
};

const FACTION_NAMES: Record<string, string> = {
  ussr: "Soviet Union",
  ger: "Germany",
  uk: "United Kingdom",
  jap: "Japan",
  usa: "United States",
  allies: "Allies",
  axis: "Axis",
  neutral: "Neutral",
};

const VERTEX_EPS = 5.0;
const MIN_SHARED_VERTICES = 2;

type Point = [number, number];

export function buildMapData(mapJson: Dict): Dict {
  const regions: Dict[] = [];
  for (const regionEntry of extractRegions(mapJson)) {
    const meta: Dict = regionEntry.metadata ?? {};
    const regionId = String(meta.region_id ?? "");
    if (regionId === "") {
      continue;
    }
    let owner = ownerFromMetadataFaction(String(meta.faction ?? ""));
    if (owner === "" && regionId === "region_1") {
      owner = "ussr";
    }
    regions.push({
      id: regionId,
      name: String(meta.name ?? "") || regionId,
      type: regionTypeFromMetadata(meta, regionId),
      ipc_value: Math.trunc(Number(meta.ipc ?? 0)),
      owner_faction_id: owner,
      is_capital: Boolean(meta.victory ?? false),
      has_factory: Boolean(meta.factory ?? false),
    });
  }
  return {
    schema_version: "0.5",
    regions,
    adjacency: buildAdjacencyFromPolygons(mapJson),
  };
}

export function buildFactionsData(mapJson: Dict = {}): Dict {
  if (Array.isArray(mapJson.factions) && mapJson.factions.length > 0) {
    return { schema_version: "0.5", factions: mapJson.factions };
  }
  return {
    schema_version: "0.5",
    factions: [
      { id: "ussr", name: "Soviet Union", color: "#9A4E48", team: "allies", turn_order: 1, starting_ipc: 15 },
      { id: "ger", name: "Germany", color: "#857577", team: "axis", turn_order: 2, starting_ipc: 22 },
      { id: "uk", name: "United Kingdom", color: "#9E7F55", team: "allies", turn_order: 3, starting_ipc: 21 },
      { id: "jap", name: "Japan", color: "#B77958", team: "axis", turn_order: 4, starting_ipc: 16 },
      { id: "usa", name: "United States", color: "#72745C", team: "allies", turn_order: 5, starting_ipc: 17 },
    ],
  };
}

export function buildSetupData(mapJson: Dict): Dict {
  if (Array.isArray(mapJson.starting_units) && mapJson.starting_units.length > 0) {
    const order = Array.isArray(mapJson.turn_order) ? mapJson.turn_order : [...TURN_ORDER];
    return { schema_version: "0.5", turn_order: order, starting_units: mapJson.starting_units };
  }
  const startingUnits: Dict[] = [];
  for (const regionEntry of extractRegions(mapJson)) {
    const meta: Dict = regionEntry.metadata ?? {};
    const regionId = String(meta.region_id ?? "");
    let owner = ownerFromMetadataFaction(String(meta.faction ?? ""));
    if (owner === "" && regionId === "region_1") {
      owner = "ussr";
    }
    if (PLAYABLE_FACTIONS.includes(owner)) {
      startingUnits.push({ region_id: regionId, faction_id: owner, unit_type_id: "infantry", count: 2 });
    }
  }
  if (startingUnits.length === 0) {
    startingUnits.push({ region_id: "region_1", faction_id: "ussr", unit_type_id: "infantry", count: 2 });
  }
  return {
    schema_version: "0.5",
    turn_order: [...TURN_ORDER],
    starting_units: startingUnits,
  };
}

export function displayNameForFactionId(factionId: string): string {
  return FACTION_NAMES[factionId.toLowerCase()] ?? factionId;
}

export function factionIdFromDisplay(displayName: string): string {
  return String(FACTION_DISPLAY[displayName] ?? displayName.toLowerCase());
}

function extractRegions(mapJson: Dict): Dict[] {
  return Array.isArray(mapJson.regions) ? mapJson.regions : [];
}

function ownerFromMetadataFaction(factionName: string): string {
  if (factionName === "" || factionName === "Neutral") {
    return "";
  }
  return factionIdFromDisplay(factionName);
}

function regionTypeFromMetadata(meta: Dict, regionId: string): string {
  const rawType = String(meta.type ?? "").toLowerCase();
  if (rawType === "land" || rawType === "sea") {
    return rawType;
  }
  if (regionId.toLowerCase().startsWith("sea zone")) {
    return "sea";
  }
  return "land";
}

/**
 * Maps authored in the web map editor list each region's `neighbors` explicitly (land, sea and coastal
 * links, with manual overrides). When any region has that array it is the whole truth; otherwise
 * adjacency comes from shared polygon vertices as in the Godot builder.
 */
function buildAdjacencyFromNeighbors(mapJson: Dict): Dict[] | null {
  const regions = extractRegions(mapJson);
  if (!regions.some((r) => Array.isArray(r.neighbors))) {
    return null;
  }
  const known = new Set(regions.map((r) => String((r.metadata ?? {}).region_id ?? "")));
  const edges: Dict[] = [];
  const seen = new Set<string>();
  for (const regionEntry of regions) {
    const fromId = String((regionEntry.metadata ?? {}).region_id ?? "");
    for (const raw of Array.isArray(regionEntry.neighbors) ? regionEntry.neighbors : []) {
      const toId = String(raw);
      if (fromId === "" || toId === fromId || !known.has(fromId) || !known.has(toId)) {
        continue;
      }
      const [a, b] = fromId < toId ? [fromId, toId] : [toId, fromId];
      if (!seen.has(`${a}|${b}`)) {
        seen.add(`${a}|${b}`);
        edges.push({ from: a, to: b });
      }
    }
  }
  return edges;
}

function buildAdjacencyFromPolygons(mapJson: Dict): Dict[] {
  const explicit = buildAdjacencyFromNeighbors(mapJson);
  if (explicit) {
    return explicit;
  }
  const polygons: Record<string, Point[]> = {};
  const regionIds: string[] = [];
  for (const regionEntry of extractRegions(mapJson)) {
    const meta: Dict = regionEntry.metadata ?? {};
    const regionId = String(meta.region_id ?? "");
    if (regionId === "") {
      continue;
    }
    regionIds.push(regionId);
    polygons[regionId] = polygonPoints(regionEntry.polygon ?? []);
  }

  const edges: Dict[] = [];
  const seen: Record<string, boolean> = {};
  for (let i = 0; i < regionIds.length; i++) {
    for (let j = i + 1; j < regionIds.length; j++) {
      const fromId = regionIds[i];
      const toId = regionIds[j];
      if (countSharedVertices(polygons[fromId] ?? [], polygons[toId] ?? [], VERTEX_EPS) < MIN_SHARED_VERTICES) {
        continue;
      }
      const key = `${fromId}|${toId}`;
      if (seen[key]) {
        continue;
      }
      seen[key] = true;
      edges.push({ from: fromId, to: toId });
    }
  }
  return edges;
}

function polygonPoints(pointsRaw: unknown[]): Point[] {
  const points: Point[] = [];
  for (const p of pointsRaw) {
    if (Array.isArray(p) && p.length >= 2) {
      points.push([Number(p[0]), Number(p[1])]);
    }
  }
  return points;
}

function countSharedVertices(polyA: Point[], polyB: Point[], eps: number): number {
  let shared = 0;
  const epsSq = eps * eps;
  for (const a of polyA) {
    for (const b of polyB) {
      const dx = a[0] - b[0];
      const dy = a[1] - b[1];
      if (dx * dx + dy * dy <= epsSq) {
        shared += 1;
      }
    }
  }
  return shared;
}
