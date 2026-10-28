import type { GameState } from "../model/game_state";
import { type Dict, isDict, type UnitStackEntry } from "../model/types";
import { godotCapitalize } from "./godot_string";

export const MOVEMENT_PHASES = ["combat_move", "noncombat_move"];

const FACTION_SUFFIXES = ["allies", "axis"];

export interface DisplayEntry {
  unit_type_id: string;
  faction_id: string;
  count: number;
  instance_id?: string;
}

/** UnitTextureCache.normalize_unit_type_and_faction */
export function normalizeUnitTypeAndFaction(unitTypeId: string, factionId: string): DisplayEntry {
  let unit = unitTypeId.toLowerCase().trim();
  let faction = factionId.toLowerCase().trim();

  for (const suffix of FACTION_SUFFIXES) {
    if (unit.endsWith(suffix) && unit.length > suffix.length) {
      faction = suffix;
      unit = unit.substring(0, unit.length - suffix.length);
      break;
    }
  }

  switch (faction) {
    case "allies":
    case "american":
    case "us":
      faction = "allies";
      break;
    case "axis":
    case "ger":
    case "germany":
    case "german":
      faction = "axis";
      break;
  }
  return { unit_type_id: unit, faction_id: faction, count: 0 };
}

export class RegionUnitDisplay {
  static buildDisplayEntries(unitsArray: unknown[]): DisplayEntry[] {
    const entries: DisplayEntry[] = [];
    const stacks: Record<string, DisplayEntry> = {};
    for (const u of unitsArray) {
      if (!isDict(u)) {
        continue;
      }
      const parsed = normalizeUnitTypeAndFaction(String(u.unit_type_id ?? ""), String(u.faction_id ?? ""));
      const unitType = parsed.unit_type_id;
      if (unitType === "") {
        continue;
      }
      const factionId = parsed.faction_id;
      if ("instance_id" in u && String(u.instance_id ?? "") !== "") {
        entries.push({
          unit_type_id: unitType,
          faction_id: factionId,
          count: Math.trunc(Number(u.count ?? 1)),
          instance_id: String(u.instance_id ?? ""),
        });
        continue;
      }
      const stackKey = `${unitType}|${factionId}`;
      if (!(stackKey in stacks)) {
        stacks[stackKey] = { unit_type_id: unitType, faction_id: factionId, count: 0 };
      }
      stacks[stackKey].count += Math.trunc(Number(u.count ?? 0));
    }
    for (const stackEntry of Object.values(stacks)) {
      entries.push(stackEntry);
    }
    return entries;
  }

  static entriesForRegionInspector(state: GameState | null, regionId: string, viewerFaction: string): DisplayEntry[] {
    if (state == null || regionId === "") {
      return [];
    }
    const owner = state.getRegionOwner(regionId);
    const units = state.getUnitsInRegion(regionId);
    if (owner === viewerFaction) {
      return RegionUnitDisplay.ownedFriendlyEntries(state, regionId, viewerFaction, units);
    }
    return RegionUnitDisplay.hostileRegionEntries(state, regionId, viewerFaction, owner, units);
  }

  static combatPoolEntries(state: GameState | null, regionId: string, attackerFaction: string): DisplayEntry[] {
    if (state == null || regionId === "") {
      return [];
    }
    if (!state.isRegionHostileTo(regionId, attackerFaction)) {
      return [];
    }
    return RegionUnitDisplay.buildDisplayEntries(state.getFactionUnitsInRegion(regionId, attackerFaction));
  }

  static combatPoolUnitCount(state: GameState | null, regionId: string, attackerFaction: string): number {
    let total = 0;
    for (const entry of RegionUnitDisplay.combatPoolEntries(state, regionId, attackerFaction)) {
      total += Math.trunc(Number(entry.count ?? 0));
    }
    return total;
  }

  static regionsWithCombatPools(state: GameState | null, attackerFaction: string): string[] {
    const result: string[] = [];
    if (state == null) {
      return result;
    }
    for (const regionId of Object.keys(state.region_units)) {
      if (RegionUnitDisplay.combatPoolUnitCount(state, regionId, attackerFaction) > 0) {
        result.push(regionId);
      }
    }
    result.sort();
    return result;
  }

  private static ownedFriendlyEntries(
    state: GameState,
    _regionId: string,
    faction: string,
    units: UnitStackEntry[],
  ): DisplayEntry[] {
    const factionUnits = units.filter((u) => isDict(u) && String(u.faction_id ?? "") === faction);
    const entries = RegionUnitDisplay.buildDisplayEntries(factionUnits);
    if (!MOVEMENT_PHASES.includes(state.current_phase)) {
      return entries;
    }
    return entries.filter((entry) => {
      const iid = String(entry.instance_id ?? "");
      return !(iid !== "" && state.hasInstanceMoved(iid));
    });
  }

  private static hostileRegionEntries(
    _state: GameState,
    _regionId: string,
    viewerFaction: string,
    owner: string,
    units: UnitStackEntry[],
  ): DisplayEntry[] {
    const displayFaction = owner !== "" ? owner : viewerFaction;
    let filteredUnits: UnitStackEntry[] = units.filter(
      (u) => isDict(u) && String(u.faction_id ?? "") === displayFaction,
    );
    if (filteredUnits.length === 0) {
      filteredUnits = units.filter((u) => isDict(u) && String(u.faction_id ?? "") !== viewerFaction);
    }
    return RegionUnitDisplay.buildDisplayEntries(filteredUnits);
  }

  static isContainerUnit(state: GameState | null, unitTypeId: string): boolean {
    if (state == null || unitTypeId === "") {
      return false;
    }
    const unit = state.unit_types[unitTypeId];
    return unit != null && isDict(unit.container) && Object.keys(unit.container).length > 0;
  }

  static cargoSummaryLines(state: GameState | null, instanceId: string): string[] {
    if (state == null || instanceId === "") {
      return ["Empty"];
    }
    const transportData: Dict = state.transport_instances[instanceId] ?? {};
    const cargo: unknown[] = transportData.cargo ?? [];
    if (cargo.length === 0) {
      return ["Empty"];
    }
    const lines: string[] = [];
    for (const entry of cargo) {
      if (!isDict(entry)) {
        continue;
      }
      const unitType = String(entry.unit_type_id ?? "");
      const count = Math.trunc(Number(entry.count ?? 0));
      if (unitType === "" || count <= 0) {
        continue;
      }
      lines.push(`${godotCapitalize(unitType)} × ${count}`);
    }
    return lines.length > 0 ? lines : ["Empty"];
  }

  static isStrategicBomber(state: GameState | null, unitTypeId: string): boolean {
    if (state == null) {
      return false;
    }
    const unit = state.unit_types[unitTypeId];
    return unit != null && Boolean(unit.special.can_strategic_bomb_factory ?? false);
  }

  static regionsWithBombTargets(state: GameState | null, attackerFaction: string): string[] {
    const result: string[] = [];
    if (state == null) {
      return result;
    }
    for (const regionId of Object.keys(state.regions)) {
      if (RegionUnitDisplay.bombUnitCount(state, regionId, attackerFaction) > 0) {
        result.push(regionId);
      }
    }
    result.sort();
    return result;
  }

  static bombUnitCount(state: GameState | null, regionId: string, attackerFaction: string): number {
    if (state == null || regionId === "") {
      return 0;
    }
    const region = state.regions[regionId];
    if (region == null || !region.isLandRegion() || !region.has_factory) {
      return 0;
    }
    if (!state.isRegionHostileTo(regionId, attackerFaction)) {
      return 0;
    }
    let total = 0;
    for (const entry of state.getFactionUnitsInRegion(regionId, attackerFaction)) {
      if (RegionUnitDisplay.isStrategicBomber(state, String(entry.unit_type_id ?? ""))) {
        total += Math.trunc(Number(entry.count ?? 0));
      }
    }
    return total;
  }

  static bombPoolEntries(state: GameState | null, regionId: string, attackerFaction: string): DisplayEntry[] {
    if (state == null || RegionUnitDisplay.bombUnitCount(state, regionId, attackerFaction) <= 0) {
      return [];
    }
    const filtered = state
      .getFactionUnitsInRegion(regionId, attackerFaction)
      .filter((entry) => RegionUnitDisplay.isStrategicBomber(state, String(entry.unit_type_id ?? "")));
    return RegionUnitDisplay.buildDisplayEntries(filtered);
  }
}
