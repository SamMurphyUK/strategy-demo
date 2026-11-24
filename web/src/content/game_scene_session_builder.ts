// Port of scripts/GameSceneSessionBuilder.gd: turns editor map JSON (demomap01.json)
// into map/factions/setup dictionaries. This is content import, not a game rule.
import { type Dict, isDict } from "../engine/model/types";

export const NEWMAP_PATH = "res://demomap01.json";
export const UNITS_PATH = "res://data/scenarios/minimal/units.json";
export const RULES_PATH = "res://data/scenarios/minimal/rules.json";

export const PLAYABLE_FACTIONS = ["ussr", "ger", "uk", "jap", "usa"];
/** Classic 1942 order: Soviet Union, Germany, United Kingdom, Japan, United States. */
export const TURN_ORDER = ["ussr", "ger", "uk", "jap", "usa"] as const;
/** Ids used by `demomap_global_1940.json`. The records (colour, team, treasury) live in that file. */
export const GLOBAL_1940_FACTION_IDS = [
  "germany",
  "soviet_union",
  "japan",
  "united_kingdom",
  "uk_pacific",
  "italy",
  "anzac",
  "china",
  "free_france",
  "united_states",
] as const;
const FACTION_DISPLAY: Record<string, string> = {
  Allies: "allies",
  Axis: "axis",
  USSR: "ussr",
  GER: "ger",
  UK: "uk",
  "UK Europe": "united_kingdom",
  "UK Pacific": "uk_pacific",
  UKP: "uk_pacific",
  USA: "usa",
  JAP: "jap",
  ITA: "italy",
  Italy: "italy",
  CHI: "china",
  China: "china",
  ANZAC: "anzac",
  FRA: "free_france",
  France: "free_france",
  "Free France": "free_france",
};

const FACTION_NAMES: Record<string, string> = {
  ussr: "Soviet Union",
  soviet_union: "Soviet Union",
  ger: "Germany",
  germany: "Germany",
  uk: "United Kingdom",
  united_kingdom: "United Kingdom (Europe)",
  uk_pacific: "United Kingdom (Pacific)",
  jap: "Japan",
  japan: "Japan",
  usa: "United States",
  united_states: "United States",
  italy: "Italy",
  china: "China",
  anzac: "ANZAC",
  free_france: "Free France",
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
    const type = regionTypeFromMetadata(meta, regionId);
    const cover = String(meta.land_cover ?? "").trim();
    regions.push({
      id: regionId,
      name: String(meta.name ?? "") || regionId,
      type,
      ipc_value: Math.trunc(Number(meta.ipc ?? 0)),
      owner_faction_id: owner,
      original_owner_id: owner,
      is_capital: Boolean(meta.victory ?? false),
      has_factory: Boolean(meta.factory ?? false) || meta.factory_size === "major" || meta.factory_size === "minor",
      major_factory: meta.factory_size === "major" || (meta.factory === true && meta.factory_size !== "minor"),
      ...(cover !== "" ? { land_cover: cover } : {}),
      ...(type === "sea" && meta.is_convoy_zone === true ? { is_convoy_zone: true } : {}),
    });
  }
  return {
    schema_version: "0.5",
    regions,
    adjacency: buildAdjacencyFromPolygons(mapJson),
  };
}

export function buildFactionsData(mapJson: Dict = {}): Dict {
  const authored = authoredFactions(mapJson);
  if (authored.length > 0) {
    return { schema_version: "0.5", factions: authored };
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

/** Playable faction ids for this map. A map with no `factions` list keeps the classic five. */
export function playableFactionIds(mapJson: Dict = {}): string[] {
  const ids = authoredFactions(mapJson).map((faction) => String(faction.id ?? "")).filter((id) => id !== "");
  return ids.length > 0 ? ids : [...PLAYABLE_FACTIONS];
}

function authoredFactions(mapJson: Dict): Dict[] {
  if (!Array.isArray(mapJson.factions)) {
    return [];
  }
  return mapJson.factions.filter((item): item is Dict => isDict(item) && String(item.id ?? "") !== "");
}

/** Land IPC each playable faction owns on this map. Sea zones and neutrals add nothing. */
export function territoryIncome(mapJson: Dict): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const regionEntry of extractRegions(mapJson)) {
    const meta: Dict = regionEntry.metadata ?? {};
    const regionId = String(meta.region_id ?? "");
    if (regionTypeFromMetadata(meta, regionId) !== "land") {
      continue;
    }
    const owner = ownerFromMetadataFaction(String(meta.faction ?? ""));
    if (!playableFactionIds(mapJson).includes(owner)) {
      continue;
    }
    totals[owner] = (totals[owner] ?? 0) + Math.trunc(Number(meta.ipc ?? 0));
  }
  return totals;
}

/**
 * A saved editor map ready to boot. Opening treasury is the land that faction owns, and a setup line
 * whose region is gone is left out. The demo file is not passed through here.
 */
export function prepareSavedMap(mapJson: Dict): Dict {
  const income = territoryIncome(mapJson);
  const factions = (buildFactionsData(mapJson).factions as Dict[]).map((faction) => ({
    ...faction,
    starting_ipc: income[String(faction.id)] ?? 0,
  }));
  const known = new Set(
    extractRegions(mapJson)
      .map((region) => String((region.metadata ?? {}).region_id ?? ""))
      .filter((id) => id !== ""),
  );
  const units = Array.isArray(mapJson.starting_units) ? mapJson.starting_units : null;
  return {
    ...mapJson,
    factions,
    ...(units
      ? { starting_units: units.filter((unit) => isDict(unit) && known.has(String(unit.region_id ?? ""))) }
      : {}),
  };
}

export function buildSetupData(mapJson: Dict): Dict {
  // An authored list, including an empty one, is the whole setup. The region_1 fallback below is only
  // for older files that omit the key; a blank slicing map must be allowed to start with no units.
  if (Array.isArray(mapJson.starting_units)) {
    return {
      schema_version: "0.5",
      turn_order: turnOrderFromMap(mapJson),
      starting_units: mapJson.starting_units,
    };
  }
  const startingUnits: Dict[] = [];
  for (const regionEntry of extractRegions(mapJson)) {
    const meta: Dict = regionEntry.metadata ?? {};
    const regionId = String(meta.region_id ?? "");
    let owner = ownerFromMetadataFaction(String(meta.faction ?? ""));
    if (owner === "" && regionId === "region_1") {
      owner = "ussr";
    }
    if (playableFactionIds(mapJson).includes(owner)) {
      startingUnits.push({ region_id: regionId, faction_id: owner, unit_type_id: "infantry", count: 2 });
    }
  }
  if (startingUnits.length === 0) {
    startingUnits.push({ region_id: "region_1", faction_id: "ussr", unit_type_id: "infantry", count: 2 });
  }
  return {
    schema_version: "0.5",
    turn_order: turnOrderFromMap(mapJson),
    starting_units: startingUnits,
  };
}

function turnOrderFromMap(mapJson: Dict): string[] {
  if (Array.isArray(mapJson.turn_order) && mapJson.turn_order.length > 0) {
    return mapJson.turn_order.map((id) => String(id));
  }
  const ranked = authoredFactions(mapJson)
    .slice()
    .sort((a, b) => Number(a.turn_order ?? 0) - Number(b.turn_order ?? 0))
    .map((faction) => String(faction.id ?? ""))
    .filter((id) => id !== "");
  return ranked.length > 0 ? ranked : [...TURN_ORDER];
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
