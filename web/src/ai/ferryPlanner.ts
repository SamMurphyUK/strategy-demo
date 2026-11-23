import type { GameState } from "../engine/model/game_state";
import { MovementValidator } from "../engine/movement/movement_validator";
import { TransportLoadValidator } from "../engine/transport/transport_load_validator";
import { assaultError } from "../engine/transport/cargo_rules";
import type { Ruleset } from "../engine/rules/ruleset";
import { classifyUnit } from "../engine/types/ruleset";
import { threatAt, type TileThreat } from "./threatMap";

export interface FerryLoad {
  transportId: string;
  from: string;
  unitType: string;
  count: number;
}

export interface FerrySail {
  from: string;
  to: string;
  unitType: string;
  count: number;
  instanceId: string;
}

export interface FerryAssault {
  transportId: string;
  originSea: string;
  target: string;
}

export const SEA_POWERS = new Set(["uk", "united_kingdom", "usa", "united_states", "jap", "japan"]);

const THEATER: { name: string; words: string[] }[] = [
  { name: "Europe", words: ["france", "normandy", "norway", "poland", "belgium", "holland", "denmark", "germany", "baltic", "karelia", "finland"] },
  { name: "Med/Africa", words: ["africa", "egypt", "morocco", "algeria", "libya", "tunisia", "mediterranean", "greece", "italy", "gibraltar"] },
  { name: "Pacific", words: ["pacific", "philippine", "solomon", "borneo", "java", "sumatra", "celebes", "indies", "guinea", "australia", "manchuria", "japan", "china", "iwo", "okinawa"] },
];

function cargoCount(state: GameState, transportId: string): number {
  return (state.transport_instances[transportId]?.cargo ?? []).reduce(
    (sum, line) => sum + Math.max(0, Math.trunc(Number(line.count ?? 0))),
    0,
  );
}

function ownerOf(state: GameState, transportId: string): { faction: string; sea: string } | null {
  const sea = String(state.transport_instances[transportId]?.region_id ?? "");
  const row = state.getUnitsInRegion(sea).find((entry) => String(entry.instance_id ?? "") === transportId);
  if (row == null) {
    return null;
  }
  return { faction: String(row.faction_id ?? ""), sea };
}

function groundHave(
  state: GameState,
  factionId: string,
  regionId: string,
  unitType: string,
  reserved: Map<string, number>,
  used: ReadonlyMap<string, number>,
): number {
  const key = `${regionId}|${unitType}`;
  let have = 0;
  for (const entry of state.getUnitsInRegion(regionId)) {
    if (String(entry.faction_id ?? "") !== factionId || String(entry.unit_type_id ?? "") !== unitType || entry.instance_id != null) {
      continue;
    }
    have += Math.max(0, Math.trunc(Number(entry.count ?? 0)));
  }
  return Math.max(0, have - (reserved.get(key) ?? 0) - (used.get(key) ?? 0));
}

function reserve(reserved: Map<string, number>, regionId: string, unitType: string, count: number): void {
  const key = `${regionId}|${unitType}`;
  reserved.set(key, (reserved.get(key) ?? 0) + count);
}

function factoryLand(state: GameState, factionId: string, seaId: string): string {
  for (const regionId of state.getAdjacentRegions(seaId)) {
    const region = state.regions[regionId];
    if (region?.isLandRegion() === true && region.has_factory && region.owner_faction_id === factionId) {
      return regionId;
    }
  }
  return "";
}

/** 1 infantry plus artillery or armor, otherwise 2 infantry. */
function besideHostileCoast(state: GameState, seaId: string, factionId: string): boolean {
  for (const regionId of state.getAdjacentRegions(seaId)) {
    const region = state.regions[regionId];
    if (region?.isLandRegion() === true && state.isRegionHostileTo(regionId, factionId)) {
      return true;
    }
  }
  return false;
}

function pickCargo(
  state: GameState,
  factionId: string,
  landId: string,
  reserved: Map<string, number>,
  used: ReadonlyMap<string, number>,
): FerryLoad[] {
  const infantry = groundHave(state, factionId, landId, "infantry", reserved, used);
  const artillery = groundHave(state, factionId, landId, "artillery", reserved, used);
  const armor = groundHave(state, factionId, landId, "tank", reserved, used);
  const lines: { unitType: string; count: number }[] = [];
  if (infantry > 0 && artillery > 0) {
    lines.push({ unitType: "infantry", count: 1 }, { unitType: "artillery", count: 1 });
  } else if (infantry > 0 && armor > 0) {
    lines.push({ unitType: "infantry", count: 1 }, { unitType: "tank", count: 1 });
  } else if (infantry >= 2) {
    lines.push({ unitType: "infantry", count: 2 });
  } else if (infantry === 1) {
    lines.push({ unitType: "infantry", count: 1 });
  }
  for (const line of lines) {
    reserve(reserved, landId, line.unitType, line.count);
  }
  return lines.map((line) => ({ transportId: "", from: landId, unitType: line.unitType, count: line.count }));
}

export function theaterOf(regionId: string, name = ""): string {
  const text = `${regionId} ${name}`.toLowerCase();
  for (const theater of THEATER) {
    if (theater.words.some((word) => text.includes(word))) {
      return theater.name;
    }
  }
  return "";
}

function landingScore(state: GameState, factionId: string, regionId: string, tiles: readonly TileThreat[]): number {
  const region = state.regions[regionId];
  if (region?.isLandRegion() !== true || !state.isRegionHostileTo(regionId, factionId)) {
    return -1;
  }
  const theater = theaterOf(region.id, region.name);
  return threatAt(tiles, regionId).strategicValue + (theater === "" ? 0 : 12);
}

function enemyAirOrSub(state: GameState, factionId: string, seaId: string): boolean {
  const seen = new Set<string>([seaId]);
  let ring = [seaId];
  for (let step = 0; step < 2; step += 1) {
    const next: string[] = [];
    for (const current of ring) {
      for (const entry of state.getUnitsInRegion(current)) {
        const owner = String(entry.faction_id ?? "");
        if (owner === "" || state.sameTeam(owner, factionId)) {
          continue;
        }
        const kind = classifyUnit(String(entry.unit_type_id ?? ""));
        if (kind === "FIGHTER" || kind === "TACTICAL_BOMBER" || kind === "HEAVY_BOMBER" || kind === "SUBMARINE") {
          return true;
        }
      }
      for (const neighbor of state.getAdjacentRegions(current)) {
        if (seen.has(neighbor) || state.regions[neighbor]?.isSeaRegion() !== true) {
          continue;
        }
        seen.add(neighbor);
        next.push(neighbor);
      }
    }
    ring = next;
  }
  return false;
}

function escorted(state: GameState, factionId: string, seaId: string): boolean {
  for (const entry of state.getUnitsInRegion(seaId)) {
    if (!state.sameTeam(String(entry.faction_id ?? ""), factionId)) {
      continue;
    }
    const kind = classifyUnit(String(entry.unit_type_id ?? ""));
    if (kind === "DESTROYER" || kind === "CARRIER") {
      return true;
    }
  }
  return false;
}

function sailAllowed(state: GameState, factionId: string, seaId: string): boolean {
  return !enemyAirOrSub(state, factionId, seaId) || escorted(state, factionId, seaId);
}

/**
 * Load an empty transport that is already beside a factory and a hostile coast,
 * then assault that coast this combat move.
 */
export function planImmediateFerry(state: GameState, factionId: string, tiles: readonly TileThreat[]): { loads: FerryLoad[]; assaults: FerryAssault[] } {
  const loads: FerryLoad[] = [];
  const assaults: FerryAssault[] = [];
  if (!SEA_POWERS.has(factionId.trim().toLowerCase())) {
    return { loads, assaults };
  }
  const reserved = new Map<string, number>();
  for (const [transportId, transport] of Object.entries(state.transport_instances)) {
    if (cargoCount(state, transportId) > 0) {
      continue;
    }
    const owned = ownerOf(state, transportId);
    if (owned == null || owned.faction !== factionId) {
      continue;
    }
    const landId = factoryLand(state, factionId, owned.sea);
    if (landId === "") {
      continue;
    }
    let best = "";
    let bestScore = 0;
    for (const coast of state.getAdjacentRegions(owned.sea)) {
      const score = landingScore(state, factionId, coast, tiles);
      if (score > bestScore && sailAllowed(state, factionId, owned.sea)) {
        best = coast;
        bestScore = score;
      }
    }
    if (best === "") {
      continue;
    }
    const cargo = pickCargo(state, factionId, landId, reserved, new Map()).filter((line) =>
      new TransportLoadValidator().canLoadUnits(transportId, landId, [{ unit_type_id: line.unitType, count: line.count }], factionId, state),
    );
    if (assaultError(state, factionId, transportId, owned.sea, best) != null) {
      continue;
    }
    if (cargo.length === 0) {
      continue;
    }
    for (const line of cargo) {
      loads.push({ ...line, transportId });
    }
    assaults.push({ transportId, originSea: owned.sea, target: best });
  }
  return { loads, assaults };
}

/**
 * Load empty transports beside a factory and, when an escort is present, step
 * one sea zone toward the highest-scoring coast.
 */
export function planStagingFerry(
  state: GameState,
  factionId: string,
  ruleset: Ruleset,
  tiles: readonly TileThreat[],
  busy: ReadonlySet<string>,
  used: ReadonlyMap<string, number> = new Map(),
): { loads: FerryLoad[]; sails: FerrySail[] } {
  const loads: FerryLoad[] = [];
  const sails: FerrySail[] = [];
  if (!SEA_POWERS.has(factionId.trim().toLowerCase())) {
    return { loads, sails };
  }
  const reserved = new Map<string, number>();
  const validator = new MovementValidator();
  for (const [transportId, transport] of Object.entries(state.transport_instances)) {
    if (busy.has(transportId) || cargoCount(state, transportId) > 0) {
      continue;
    }
    const owned = ownerOf(state, transportId);
    if (owned == null || owned.faction !== factionId || String(transport.unit_type_id ?? "") !== "transport") {
      continue;
    }
    const sea = owned.sea;
    let landId = factoryLand(state, factionId, sea);
    if (landId === "") {
      const docks = validator
        .getLegalDestinationsForInstance(transportId, factionId, state, ruleset)
        .filter((dest) => factoryLand(state, factionId, dest) !== "" && sailAllowed(state, factionId, dest));
      const dock = docks[0] ?? "";
      if (dock !== "") {
        sails.push({ from: sea, to: dock, unitType: "transport", count: 1, instanceId: transportId });
        landId = factoryLand(state, factionId, dock);
      }
    }
    const dockSea = sails.find((sail) => sail.instanceId === transportId)?.to ?? sea;
    if (landId === "" || (state.rulesetConfig.facilitiesAndPatrols && besideHostileCoast(state, dockSea, factionId))) {
      continue;
    }
    const cargo = pickCargo(state, factionId, landId, reserved, used);
    for (const line of cargo) {
      loads.push({ ...line, transportId });
    }
  }
  for (const [transportId] of Object.entries(state.transport_instances)) {
    if (busy.has(transportId) || cargoCount(state, transportId) <= 0) {
      continue;
    }
    const owned = ownerOf(state, transportId);
    if (owned == null || owned.faction !== factionId || sails.some((sail) => sail.instanceId === transportId)) {
      continue;
    }
    let bestSea = "";
    let bestScore = 0;
    for (const dest of validator.getLegalDestinationsForInstance(transportId, factionId, state, ruleset)) {
      if (dest === owned.sea || !sailAllowed(state, factionId, dest)) {
        continue;
      }
      for (const coast of state.getAdjacentRegions(dest)) {
        const score = landingScore(state, factionId, coast, tiles);
        if (score > bestScore) {
          bestScore = score;
          bestSea = dest;
        }
      }
    }
    if (bestSea !== "") {
      sails.push({ from: owned.sea, to: bestSea, unitType: "transport", count: 1, instanceId: transportId });
    }
  }
  return { loads, sails };
}

/** A loaded transport beside a hostile coast has to assault or combat move cannot end. */
export function commitLoadedCoasts(state: GameState, factionId: string, already: ReadonlySet<string>): FerryAssault[] {
  const assaults: FerryAssault[] = [];
  if (!state.rulesetConfig.facilitiesAndPatrols) {
    return assaults;
  }
  for (const [transportId] of Object.entries(state.transport_instances)) {
    if (already.has(transportId) || cargoCount(state, transportId) <= 0) {
      continue;
    }
    const owned = ownerOf(state, transportId);
    if (owned == null || owned.faction !== factionId || !besideHostileCoast(state, owned.sea, factionId)) {
      continue;
    }
    for (const coast of state.getAdjacentRegions(owned.sea)) {
      if (assaultError(state, factionId, transportId, owned.sea, coast) != null) {
        continue;
      }
      assaults.push({ transportId, originSea: owned.sea, target: coast });
      break;
    }
  }
  return assaults;
}
