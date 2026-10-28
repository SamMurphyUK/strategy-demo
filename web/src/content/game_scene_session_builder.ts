// Port of scripts/GameSceneSessionBuilder.gd: turns editor map JSON (demomap01.json)
// into map/factions/setup dictionaries. This is content import, not a game rule.
import type { Dict } from "../engine/model/types";

export const NEWMAP_PATH = "res://demomap01.json";
export const UNITS_PATH = "res://data/scenarios/minimal/units.json";
export const RULES_PATH = "res://data/scenarios/minimal/rules.json";

export const PLAYABLE_FACTIONS = ["allies", "axis"];
const FACTION_DISPLAY: Record<string, string> = {
  Allies: "allies",
  Axis: "axis",
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
      owner = "allies";
    }
    regions.push({
      id: regionId,
      name: regionId,
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

export function buildFactionsData(): Dict {
  return {
    schema_version: "0.5",
    factions: [
      { id: "allies", name: "Allies", color: "#3366CC", starting_ipc: 30 },
      { id: "axis", name: "Axis", color: "#CC3333", starting_ipc: 30 },
    ],
  };
}

export function buildSetupData(mapJson: Dict): Dict {
  const startingUnits: Dict[] = [];
  for (const regionEntry of extractRegions(mapJson)) {
    const meta: Dict = regionEntry.metadata ?? {};
    const regionId = String(meta.region_id ?? "");
    let owner = ownerFromMetadataFaction(String(meta.faction ?? ""));
    if (owner === "" && regionId === "region_1") {
      owner = "allies";
    }
    if (PLAYABLE_FACTIONS.includes(owner)) {
      startingUnits.push({ region_id: regionId, faction_id: owner, unit_type_id: "infantry", count: 2 });
    }
  }
  if (startingUnits.length === 0) {
    startingUnits.push({ region_id: "region_1", faction_id: "allies", unit_type_id: "infantry", count: 2 });
  }
  return {
    schema_version: "0.5",
    turn_order: ["allies", "axis"],
    starting_units: startingUnits,
  };
}

export function displayNameForFactionId(factionId: string): string {
  switch (factionId) {
    case "allies":
      return "Allies";
    case "axis":
      return "Axis";
    default:
      return factionId;
  }
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

function buildAdjacencyFromPolygons(mapJson: Dict): Dict[] {
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
