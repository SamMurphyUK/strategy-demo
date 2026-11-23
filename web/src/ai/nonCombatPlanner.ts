import { canLandAt, isAirUnit, isLanded } from "../engine/air/air_fuel";
import { planStagingFerry } from "./ferryPlanner";
import { coverOf } from "../engine/rules/optional/terrainResolver";
import { threatAt } from "./threatMap";
import type { GameState } from "../engine/model/game_state";
import { MovementValidator } from "../engine/movement/movement_validator";
import { operationalAirbase, operationalHarbor } from "../engine/rules/optional/facilitiesResolver";
import type { Ruleset } from "../engine/rules/ruleset";
import { TransportLoadValidator } from "../engine/transport/transport_load_validator";
import { classifyUnit, type RulesetUnitType } from "../engine/types/ruleset";
import type { AttackPackage } from "./combatMoveGen";
import type { TileThreat } from "./threatMap";

export interface QuietMove {
  from: string;
  to: string;
  unitType: string;
  count: number;
  instanceId?: string;
}

export interface StagedLoad {
  transportId: string;
  from: string;
  unitType: string;
  count: number;
}

export interface PatrolOrder {
  region_id: string;
  count: number;
}

const AIR: ReadonlySet<RulesetUnitType> = new Set(["FIGHTER", "TACTICAL_BOMBER", "HEAVY_BOMBER"]);
const GROUND: ReadonlySet<RulesetUnitType> = new Set(["INFANTRY", "ARTILLERY", "ARMOR", "CHINESE_GUERRILLA", "MECH"]);
const PATROL_CAP = 3;

function spent(used: ReadonlyMap<string, number>, regionId: string, unitType: string): number {
  return used.get(`${regionId}|${unitType}`) ?? 0;
}

function besideHostileCoast(state: GameState, seaId: string, factionId: string): boolean {
  for (const regionId of state.getAdjacentRegions(seaId)) {
    const region = state.regions[regionId];
    if (region?.isLandRegion() === true && state.isRegionHostileTo(regionId, factionId)) {
      return true;
    }
  }
  return false;
}

function enemyStrikeNearby(state: GameState, factionId: string, regionId: string): boolean {
  const look = [regionId, ...state.getAdjacentRegions(regionId)];
  for (const id of look) {
    for (const entry of state.getUnitsInRegion(id)) {
      const owner = String(entry.faction_id ?? "");
      if (owner === "" || state.sameTeam(owner, factionId)) {
        continue;
      }
      const kind = classifyUnit(String(entry.unit_type_id ?? ""));
      if (kind === "HEAVY_BOMBER" || kind === "TACTICAL_BOMBER" || kind === "TRANSPORT") {
        return true;
      }
    }
    for (const transport of Object.values(state.transport_instances)) {
      if (String(transport.region_id ?? "") !== id) {
        continue;
      }
      const cargo = (transport.cargo ?? []).reduce((sum, line) => sum + Math.max(0, Math.trunc(Number(line.count ?? 0))), 0);
      if (cargo > 0) {
        return true;
      }
    }
  }
  return false;
}

function capStations(state: GameState, factionId: string): string[] {
  if (!state.rulesetConfig.facilitiesAndPatrols) {
    return [];
  }
  const stations: string[] = [];
  for (const region of Object.values(state.regions)) {
    const airbase = operationalAirbase(state, region.id, factionId);
    const carrier = state.getUnitsInRegion(region.id).some(
      (entry) => state.sameTeam(String(entry.faction_id ?? ""), factionId) && classifyUnit(String(entry.unit_type_id ?? "")) === "CARRIER",
    );
    if ((airbase || carrier) && enemyStrikeNearby(state, factionId, region.id)) {
      stations.push(region.id);
    }
  }
  return stations;
}

function harborSea(state: GameState, factionId: string, seaId: string): boolean {
  if (!state.rulesetConfig.facilitiesAndPatrols || besideHostileCoast(state, seaId, factionId)) {
    return false;
  }
  return state.getAdjacentRegions(seaId).some((regionId) => operationalHarbor(state, regionId, factionId));
}

function firstStep(state: GameState, factionId: string, from: string, goal: string): string {
  if (from === goal || goal === "") {
    return "";
  }
  const seen = new Set<string>([from]);
  const previous = new Map<string, string>();
  const frontier = [from];
  while (frontier.length > 0) {
    const current = frontier.shift()!;
    for (const next of state.getAdjacentRegions(current)) {
      if (seen.has(next)) {
        continue;
      }
      const region = state.regions[next];
      if (region == null || !region.isLandRegion()) {
        continue;
      }
      const owned = region.owner_faction_id !== "" && state.sameTeam(region.owner_faction_id, factionId);
      if (!owned && next !== goal) {
        continue;
      }
      previous.set(next, current);
      if (next === goal) {
        let step = next;
        while (previous.get(step) !== from) {
          const prior = previous.get(step);
          if (prior == null) {
            return "";
          }
          step = prior;
        }
        return step;
      }
      seen.add(next);
      frontier.push(next);
    }
  }
  return "";
}

/**
 * Lands aircraft that did not attack. When staging is on, fighters patrol a
 * threatened airbase or carrier, empty transports load at a safe harbor, and
 * rear land units take one step toward the most threatened hold.
 */
export function planNonCombat(
  state: GameState,
  factionId: string,
  ruleset: Ruleset,
  attacks: readonly AttackPackage[],
  stage: boolean,
  tiles: readonly TileThreat[] = [],
  busy: ReadonlySet<string> = new Set(),
): { moves: QuietMove[]; loads: StagedLoad[]; patrols: PatrolOrder[] } {
  const used = new Map<string, number>();
  for (const attack of attacks) {
    for (const stack of attack.stacks) {
      const key = `${stack.from}|${stack.unitType}`;
      used.set(key, (used.get(key) ?? 0) + stack.count);
    }
  }
  const validator = new MovementValidator();
  const stations = new Set(stage ? capStations(state, factionId) : []);
  const moves: QuietMove[] = [];
  const landingAt = new Map<string, number>();

  for (const regionId of Object.keys(state.region_units)) {
    for (const entry of state.getFactionUnitsInRegion(regionId, factionId)) {
      const unitType = String(entry.unit_type_id ?? "");
      const kind = classifyUnit(unitType);
      if (kind == null || !AIR.has(kind)) {
        continue;
      }
      const have = Math.max(0, state.movableStackCount(factionId, regionId, unitType) - spent(used, regionId, unitType));
      if (have <= 0 || isLanded(state, factionId, unitType, regionId)) {
        continue;
      }
      const spots = validator
        .getLegalDestinationsForStack(regionId, unitType, factionId, state, ruleset)
        .filter((dest) => canLandAt(state, factionId, unitType, dest, 1))
        .sort((a, b) => {
          const prefer = (dest: string) => (kind === "FIGHTER" && stations.has(dest) ? 2 : canLandAt(state, factionId, unitType, dest, have) ? 1 : 0);
          return prefer(b) - prefer(a) || (a < b ? -1 : a > b ? 1 : 0);
        });
      if (spots.length === 0) {
        continue;
      }
      const chosen = spots[0];
      let count = have;
      if (!canLandAt(state, factionId, unitType, chosen, count)) {
        count = 1;
        while (count < have && canLandAt(state, factionId, unitType, chosen, count + 1)) {
          count += 1;
        }
      }
      if (kind === "FIGHTER" && stations.has(chosen)) {
        count = Math.min(count, PATROL_CAP);
      }
      if (count <= 0 || !canLandAt(state, factionId, unitType, chosen, count)) {
        continue;
      }
      moves.push({ from: regionId, to: chosen, unitType, count });
      if (kind === "FIGHTER") {
        landingAt.set(chosen, (landingAt.get(chosen) ?? 0) + count);
      }
      const left = have - count;
      if (left > 0) {
        const other = spots.find((dest) => dest !== chosen && canLandAt(state, factionId, unitType, dest, left));
        if (other != null) {
          moves.push({ from: regionId, to: other, unitType, count: left });
        }
      }
    }
  }

  const loads: StagedLoad[] = [];
  const reserved = new Map<string, number>();
  const reserve = (regionId: string, unitType: string, count: number) => {
    const key = `${regionId}|${unitType}`;
    reserved.set(key, (reserved.get(key) ?? 0) + count);
  };
  if (stage) {
    const loader = new TransportLoadValidator();
    for (const [transportId, transport] of Object.entries(state.transport_instances)) {
      if (loads.length > 0) {
        break;
      }
      const cargo = (transport.cargo ?? []).reduce((sum, line) => sum + Math.max(0, Math.trunc(Number(line.count ?? 0))), 0);
      if (cargo > 0) {
        continue;
      }
      const sea = String(transport.region_id ?? "");
      const owner = state.getUnitsInRegion(sea).find((entry) => String(entry.instance_id ?? "") === transportId);
      if (owner == null || String(owner.faction_id ?? "") !== factionId) {
        continue;
      }
      let dock = harborSea(state, factionId, sea) ? sea : "";
      if (dock === "") {
        const seas = validator
          .getLegalDestinationsForInstance(transportId, factionId, state, ruleset)
          .filter((dest) => harborSea(state, factionId, dest));
        dock = seas[0] ?? "";
        if (dock !== "") {
          moves.push({ from: sea, to: dock, unitType: "transport", count: 1, instanceId: transportId });
        }
      }
      if (dock === "") {
        continue;
      }
      for (const landId of state.getAdjacentRegions(dock)) {
        const land = state.regions[landId];
        if (land == null || !land.isLandRegion() || land.owner_faction_id !== factionId) {
          continue;
        }
        const infantry = Math.max(0, state.movableStackCount(factionId, landId, "infantry") - spent(used, landId, "infantry"));
        const artillery = Math.max(0, state.movableStackCount(factionId, landId, "artillery") - spent(used, landId, "artillery"));
        const armor = Math.max(0, state.movableStackCount(factionId, landId, "tank") - spent(used, landId, "tank"));
        const lines: { unit_type_id: string; count: number }[] = [];
        if (infantry > 0 && artillery > 0) {
          lines.push({ unit_type_id: "infantry", count: 1 }, { unit_type_id: "artillery", count: 1 });
        } else if (infantry > 0 && armor > 0) {
          lines.push({ unit_type_id: "infantry", count: 1 }, { unit_type_id: "tank", count: 1 });
        } else if (infantry >= 2) {
          lines.push({ unit_type_id: "infantry", count: 2 });
        } else if (infantry === 1) {
          lines.push({ unit_type_id: "infantry", count: 1 });
        }
        if (lines.length === 0) {
          continue;
        }
        const alreadyThere = sea === dock && loader.canLoadUnits(transportId, landId, lines, factionId, state);
        const arriving = sea !== dock;
        if (!alreadyThere && !arriving) {
          continue;
        }
        for (const line of lines) {
          loads.push({ transportId, from: landId, unitType: line.unit_type_id, count: line.count });
          reserve(landId, line.unit_type_id, line.count);
        }
        break;
      }
    }
  }

  if (stage) {
    const goal =
      tiles
        .filter((tile) => tile.zoneClassification === "HOLD_LINE" && state.regions[tile.regionId]?.owner_faction_id === factionId)
        .sort((a, b) => b.enemyThreat1Turn - a.enemyThreat1Turn)[0]?.regionId ?? "";
    if (goal !== "") {
      for (const regionId of Object.keys(state.region_units)) {
        if (regionId === goal) {
          continue;
        }
        for (const entry of state.getFactionUnitsInRegion(regionId, factionId)) {
          const unitType = String(entry.unit_type_id ?? "");
          const kind = classifyUnit(unitType);
          if (kind == null || !GROUND.has(kind) || entry.instance_id != null) {
            continue;
          }
          const have = Math.max(
            0,
            state.movableStackCount(factionId, regionId, unitType) - spent(used, regionId, unitType) - (reserved.get(`${regionId}|${unitType}`) ?? 0),
          );
          if (have <= 0) {
            continue;
          }
          const step = firstStep(state, factionId, regionId, goal);
          if (step === "" || !validator.getLegalDestinationsForStack(regionId, unitType, factionId, state, ruleset).includes(step)) {
            continue;
          }
          moves.push({ from: regionId, to: step, unitType, count: have });
        }
      }
    }
  }

  const ferry = planStagingFerry(state, factionId, ruleset, tiles, busy, used);
  const loader = new TransportLoadValidator();
  for (const load of ferry.loads) {
    if (loads.some((line) => line.transportId === load.transportId && line.unitType === load.unitType)) {
      continue;
    }
    const sailing = ferry.sails.find((sail) => sail.instanceId === load.transportId);
    const ship = state.transport_instances[load.transportId];
    const parked = ship?.region_id;
    if (sailing != null && ship != null) {
      ship.region_id = sailing.to;
    }
    const legal = loader.canLoadUnits(load.transportId, load.from, [{ unit_type_id: load.unitType, count: load.count }], factionId, state);
    if (ship != null && parked != null) {
      ship.region_id = parked;
    }
    if (!legal) {
      continue;
    }
    loads.push(load);
    reserve(load.from, load.unitType, load.count);
  }
  for (const sail of ferry.sails) {
    if (moves.some((move) => move.instanceId === sail.instanceId)) {
      continue;
    }
    moves.push(sail);
  }
  consolidateSoviets(state, factionId, ruleset, tiles, used, reserved, moves);

  const patrols: PatrolOrder[] = [];
  if (stage && state.rulesetConfig.facilitiesAndPatrols) {
    for (const station of stations) {
      let fighters = landingAt.get(station) ?? 0;
      for (const entry of state.getFactionUnitsInRegion(station, factionId)) {
        if (classifyUnit(String(entry.unit_type_id ?? "")) !== "FIGHTER") {
          continue;
        }
        fighters += Math.max(0, state.movableStackCount(factionId, station, "fighter") - spent(used, station, "fighter"));
      }
      const count = Math.min(PATROL_CAP, fighters);
      if (count > 0) {
        patrols.push({ region_id: station, count });
      }
    }
  }

  return { moves, loads, patrols };
}

const SOVIET_HUBS = ["moscow", "leningrad", "stalingrad"];

function sovietFaction(factionId: string): boolean {
  const id = factionId.trim().toLowerCase();
  return id === "ussr" || id === "soviet_union";
}

function vitalHub(state: GameState, regionId: string, factionId: string): boolean {
  const region = state.regions[regionId];
  if (region == null) {
    return false;
  }
  const text = `${region.id} ${region.name}`.toLowerCase();
  if (SOVIET_HUBS.some((name) => text.includes(name))) {
    return true;
  }
  return region.is_capital === true && region.owner_faction_id === factionId;
}

function defensePower(state: GameState, factionId: string, regionId: string): number {
  let total = 0;
  for (const entry of state.getUnitsInRegion(regionId)) {
    if (!state.sameTeam(String(entry.faction_id ?? ""), factionId)) {
      continue;
    }
    const unit = state.unit_types[String(entry.unit_type_id ?? "")];
    total += Math.max(0, Math.trunc(Number(entry.count ?? 0))) * Math.max(0, unit?.defense ?? 0);
  }
  return total;
}

function nearestHub(state: GameState, factionId: string, from: string, hubs: readonly string[]): string {
  if (hubs.length === 0) {
    return "";
  }
  const seen = new Set<string>([from]);
  let ring = [from];
  for (let guard = 0; guard < 40 && ring.length > 0; guard += 1) {
    const next: string[] = [];
    for (const current of ring) {
      for (const neighbor of state.getAdjacentRegions(current)) {
        if (seen.has(neighbor)) {
          continue;
        }
        const region = state.regions[neighbor];
        if (region?.isLandRegion() !== true || region.owner_faction_id !== factionId) {
          continue;
        }
        if (hubs.includes(neighbor)) {
          return neighbor;
        }
        seen.add(neighbor);
        next.push(neighbor);
      }
    }
    ring = next;
  }
  return hubs[0] ?? "";
}

function consolidateSoviets(
  state: GameState,
  factionId: string,
  ruleset: Ruleset,
  tiles: readonly TileThreat[],
  used: Map<string, number>,
  reserved: Map<string, number>,
  moves: QuietMove[],
): void {
  if (!sovietFaction(factionId)) {
    return;
  }
  const validator = new MovementValidator();
  const hubs = Object.keys(state.regions).filter((regionId) => {
    const region = state.regions[regionId];
    if (region?.isLandRegion() !== true || region.owner_faction_id !== factionId) {
      return false;
    }
    const cover = coverOf(state, regionId);
    return vitalHub(state, regionId, factionId) || cover === "FOREST" || cover === "URBAN";
  });
  const stepGround = (regionId: string, goal: string) => {
    if (goal === "" || goal === regionId) {
      return;
    }
    const step = firstStep(state, factionId, regionId, goal);
    if (step === "") {
      return;
    }
    for (const entry of state.getFactionUnitsInRegion(regionId, factionId)) {
      const unitType = String(entry.unit_type_id ?? "");
      const kind = classifyUnit(unitType);
      if (kind == null || !GROUND.has(kind) || entry.instance_id != null) {
        continue;
      }
      const have = Math.max(
        0,
        state.movableStackCount(factionId, regionId, unitType) - spent(used, regionId, unitType) - (reserved.get(`${regionId}|${unitType}`) ?? 0),
      );
      if (have <= 0 || !validator.getLegalDestinationsForStack(regionId, unitType, factionId, state, ruleset).includes(step)) {
        continue;
      }
      moves.push({ from: regionId, to: step, unitType, count: have });
      const key = `${regionId}|${unitType}`;
      reserved.set(key, (reserved.get(key) ?? 0) + have);
    }
  };
  for (const regionId of Object.keys(state.regions)) {
    const region = state.regions[regionId];
    if (region?.isLandRegion() !== true || region.owner_faction_id !== factionId || vitalHub(state, regionId, factionId)) {
      continue;
    }
    const power = threatAt(tiles, regionId).enemyReachableAttackPower;
    const ours = defensePower(state, factionId, regionId);
    if (power <= 0 || ours / (ours + power) >= 0.45) {
      continue;
    }
    stepGround(regionId, nearestHub(state, factionId, regionId, hubs));
  }
  for (const hub of hubs) {
    if (!vitalHub(state, hub, factionId) || threatAt(tiles, hub).enemyReachableAttackPower <= 0) {
      continue;
    }
    for (const regionId of Object.keys(state.regions)) {
      if (regionId === hub || state.regions[regionId]?.owner_faction_id !== factionId) {
        continue;
      }
      stepGround(regionId, hub);
    }
  }
}
