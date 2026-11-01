import type { GameState } from "../model/game_state";
import type { Dict } from "../model/types";

export class Ruleset {
  // ---------------------------------------------------------
  // DATA DEFINITIONS
  // ---------------------------------------------------------

  /** { unit_type: { move, cost, ... } } */
  unit_defs: Record<string, Dict> = {};
  unit_move_ranges: Record<string, number> = {};
  transport_capacity: Record<string, number> = {};
  amphibious_rules: Dict = {};

  // ---------------------------------------------------------
  // UNIT DEFINITION HELPERS
  // ---------------------------------------------------------

  getUnitDef(unitType: string): Dict {
    return this.unit_defs[unitType] ?? {};
  }

  getUnitMoveRange(unitType: string, state: GameState | null = null): number {
    if (unitType in this.unit_move_ranges) {
      return Math.trunc(Number(this.unit_move_ranges[unitType]));
    }
    const def = this.getUnitDef(unitType);
    if ("move" in def) {
      return Math.trunc(Number(def.move ?? 0));
    }
    if (state != null) {
      const unit = state.unit_types[unitType];
      if (unit != null) {
        return unit.movement;
      }
    }
    return 0;
  }

  syncFromState(state: GameState): void {
    this.unit_defs = {};
    this.unit_move_ranges = {};
    for (const utid of Object.keys(state.unit_types)) {
      const unit = state.unit_types[utid];
      if (unit == null) {
        continue;
      }
      this.unit_defs[utid] = {
        move: unit.movement,
        cost: unit.cost,
        category: unit.category,
        special: unit.special,
      };
      this.unit_move_ranges[utid] = unit.movement;
    }
  }

  unitCanBlitz(unitType: string, state: GameState): boolean {
    const unit = state.unit_types[unitType];
    if (unit == null) {
      return false;
    }
    return Boolean(unit.special.can_blitz ?? false);
  }

  unitCanStrategicBomb(unitType: string, state: GameState): boolean {
    const unit = state.unit_types[unitType];
    if (unit == null) {
      return false;
    }
    return Boolean(unit.special.can_strategic_bomb_factory ?? false);
  }

  isValidBombTarget(regionId: string, factionId: string, state: GameState): boolean {
    const region = state.regions[regionId];
    if (region == null || !region.isLandRegion() || !region.has_factory) {
      return false;
    }
    if (!this.isRegionHostileTo(regionId, factionId, state)) {
      return false;
    }
    return region.owner_faction_id !== factionId;
  }

  getUnitCost(unitType: string): number {
    const def = this.getUnitDef(unitType);
    return Math.trunc(Number(def.cost ?? 0));
  }

  // ---------------------------------------------------------
  // PURCHASE + RULE LOGIC
  // ---------------------------------------------------------

  canPurchaseUnit(unitType: string, _state: GameState): boolean {
    return Object.keys(this.getUnitDef(unitType)).length > 0;
  }

  canUnitEnterRegion(unitType: string, regionId: string, state: GameState, phase: string): boolean {
    const region = state.regions[regionId];
    if (region == null) {
      return false;
    }
    const unit = state.unit_types[unitType];
    if (unit == null) {
      return false;
    }

    switch (unit.category) {
      case "land":
        if (!region.isLandRegion()) {
          return false;
        }
        break;
      case "sea":
        if (!region.isSeaRegion()) {
          return false;
        }
        break;
      case "air":
        break;
    }

    if (phase === "noncombat_move" && this.isRegionHostileTo(regionId, state.current_faction_id, state)) {
      return false;
    }

    return true;
  }

  isRegionHostileTo(regionId: string, factionId: string, state: GameState): boolean {
    return state.isRegionHostileTo(regionId, factionId);
  }

  getUnitCategory(unitType: string, state: GameState): string {
    const unit = state.unit_types[unitType];
    if (unit == null) {
      return "";
    }
    return String(unit.category);
  }

  isSeaUnit(unitType: string, state: GameState): boolean {
    return this.getUnitCategory(unitType, state) === "sea";
  }

  canMobilizeUnitAt(unitType: string, regionId: string, factionId: string, state: GameState): boolean {
    const region = state.regions[regionId];
    const unit = state.unit_types[unitType];
    if (region == null || unit == null) {
      return false;
    }
    if (unit.category === "sea") {
      if (!region.isSeaRegion()) {
        return false;
      }
      return this.isSeaZoneAdjacentToFactionFactory(regionId, factionId, state);
    }
    if (!region.isLandRegion()) {
      return false;
    }
    if (!region.has_factory) {
      return false;
    }
    return region.owner_faction_id === factionId;
  }

  isSeaZoneAdjacentToFactionFactory(seaZoneId: string, factionId: string, state: GameState): boolean {
    const sea = state.regions[seaZoneId];
    if (sea == null || !sea.isSeaRegion()) {
      return false;
    }
    for (const factoryId of Object.keys(state.regions)) {
      const factory = state.regions[factoryId];
      if (factory.has_factory && factory.owner_faction_id === factionId) {
        if (state.isAdjacent(seaZoneId, factoryId)) {
          return true;
        }
      }
    }
    return false;
  }

  getLegalMobilizeRegions(factionId: string, unitType: string, state: GameState): string[] {
    const legal: string[] = [];
    if (unitType === "" || factionId === "") {
      return legal;
    }
    const unit = state.unit_types[unitType];
    if (unit == null) {
      return legal;
    }
    for (const regionId of Object.keys(state.regions)) {
      if (this.canMobilizeUnitAt(unitType, regionId, factionId, state)) {
        legal.push(regionId);
      }
    }
    return legal;
  }

  // ---------------------------------------------------------
  // RNG HOOKS (stubs)
  // ---------------------------------------------------------

  rollCombatDice(_attackerUnits: unknown[], _defenderUnits: unknown[], _rng: unknown): null {
    return null;
  }

  rollAaFire(_aaUnits: unknown[], _incomingAirUnits: unknown[], _rng: unknown): null {
    return null;
  }

  rollBombingDamage(_bomber: unknown, _targetFactory: unknown, _rng: unknown): null {
    return null;
  }

  rollConvoyRaid(_submarines: unknown[], _convoyZone: string, _rng: unknown): null {
    return null;
  }
}
