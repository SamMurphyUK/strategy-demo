import { CarrierConstraintChecker } from "../air/carrier_constraint_checker";
import type { GameState } from "../model/game_state";
import type { Dict } from "../model/types";
import type { Ruleset } from "../rules/ruleset";
import {
  MoveError,
  type NonCombatMovementBatch,
  UnitMovePreview,
  ValidationResult,
} from "../validation/validation_types";

export class MovementValidator {
  getLegalMovesForUnit(unitId: number, state: GameState, ruleset: Ruleset): UnitMovePreview {
    const preview = new UnitMovePreview();

    const unit: Dict = state.getUnit(unitId);
    const start = String(unit.region ?? "");
    if (start === "") {
      return preview;
    }

    const unitTypeId = String(unit.unit_type_id ?? "");
    const moveRange = ruleset.getUnitMoveRange(unitTypeId, state);

    const seaOnly = ruleset.isSeaUnit(unitTypeId, state);
    const reachable = this.floodFill(start, moveRange, state, seaOnly, String(unit.faction_id ?? ""));

    for (const region of reachable) {
      if (ruleset.canUnitEnterRegion(unitTypeId, region, state, state.current_phase)) {
        preview.legal_regions.push(region);
      } else {
        preview.illegal_regions[region] = "ILLEGAL_DESTINATION";
      }
    }
    return preview;
  }

  getLegalDestinationsForStack(
    fromRegion: string,
    unitTypeId: string,
    factionId: string,
    state: GameState,
    ruleset: Ruleset,
  ): string[] {
    const legal: string[] = [];
    if (fromRegion === "" || unitTypeId === "") {
      return legal;
    }
    if (state.movableStackCount(factionId, fromRegion, unitTypeId) <= 0) {
      return legal;
    }
    let moveRange = ruleset.getUnitMoveRange(unitTypeId, state);
    if (moveRange <= 0) {
      moveRange = 1;
    }
    const seaOnly = ruleset.isSeaUnit(unitTypeId, state);
    for (const dest of this.floodFill(fromRegion, moveRange, state, seaOnly, factionId)) {
      if (ruleset.canUnitEnterRegion(unitTypeId, dest, state, state.current_phase)) {
        legal.push(dest);
      }
    }
    return legal;
  }

  getLegalDestinationsForInstance(
    instanceId: string,
    factionId: string,
    state: GameState,
    ruleset: Ruleset,
  ): string[] {
    const legal: string[] = [];
    if (instanceId === "" || state.hasInstanceMoved(instanceId)) {
      return legal;
    }
    const fromRegion = this.instanceRegion(instanceId, state);
    if (fromRegion === "") {
      return legal;
    }
    const unitTypeId = this.instanceUnitType(instanceId, state);
    if (unitTypeId === "") {
      return legal;
    }
    let moveRange = ruleset.getUnitMoveRange(unitTypeId, state);
    if (moveRange <= 0) {
      moveRange = 1;
    }
    const seaOnly = ruleset.isSeaUnit(unitTypeId, state);
    for (const dest of this.floodFill(fromRegion, moveRange, state, seaOnly, factionId)) {
      if (ruleset.canUnitEnterRegion(unitTypeId, dest, state, state.current_phase)) {
        legal.push(dest);
      }
    }
    return legal;
  }

  validateInstanceMove(
    fromRegion: string,
    toRegion: string,
    instanceId: string,
    factionId: string,
    state: GameState,
    ruleset: Ruleset,
  ): ValidationResult {
    const result = new ValidationResult();
    const unitTypeId = this.instanceUnitType(instanceId, state);
    if (unitTypeId === "") {
      result.errors.push(MoveError.of("MOVE_INVALID", "Unknown ship instance"));
    } else if (fromRegion === "" || toRegion === "") {
      result.errors.push(MoveError.of("MOVE_INVALID", "Missing from/to region"));
    } else if (fromRegion === toRegion) {
      result.errors.push(MoveError.of("MOVE_INVALID", "Cannot move to the same region"));
    } else if (state.hasInstanceMoved(instanceId)) {
      result.errors.push(MoveError.of("MOVE_ALREADY_MOVED", "Ship already moved this phase"));
    } else if (this.instanceRegion(instanceId, state) !== fromRegion) {
      result.errors.push(MoveError.of("MOVE_INVALID", `Ship is not in ${fromRegion}`));
    } else if (
      !state.isAdjacent(fromRegion, toRegion) &&
      !this.floodFill(
        fromRegion,
        ruleset.getUnitMoveRange(unitTypeId, state),
        state,
        ruleset.isSeaUnit(unitTypeId, state),
        factionId,
      ).includes(toRegion)
    ) {
      result.errors.push(MoveError.of("MOVE_OUT_OF_RANGE", "Destination is out of movement range"));
    } else if (!ruleset.canUnitEnterRegion(unitTypeId, toRegion, state, state.current_phase)) {
      result.errors.push(MoveError.of("MOVE_ILLEGAL_DESTINATION", `Ship cannot enter ${toRegion}`));
    }
    result.ok = result.errors.length === 0;
    return result;
  }

  validateStackMove(
    fromRegion: string,
    toRegion: string,
    unitTypeId: string,
    factionId: string,
    count: number,
    state: GameState,
    ruleset: Ruleset,
  ): ValidationResult {
    const result = new ValidationResult();

    if (fromRegion === "" || toRegion === "") {
      result.errors.push(MoveError.of("MOVE_INVALID", "Missing from/to region"));
    } else if (fromRegion === toRegion) {
      result.errors.push(MoveError.of("MOVE_INVALID", "Cannot move to the same region"));
    } else if (
      !state.isAdjacent(fromRegion, toRegion) &&
      !this.floodFill(
        fromRegion,
        ruleset.getUnitMoveRange(unitTypeId, state),
        state,
        ruleset.isSeaUnit(unitTypeId, state),
        factionId,
      ).includes(toRegion)
    ) {
      result.errors.push(MoveError.of("MOVE_OUT_OF_RANGE", "Destination is out of movement range"));
    } else if (!ruleset.canUnitEnterRegion(unitTypeId, toRegion, state, state.current_phase)) {
      result.errors.push(MoveError.of("MOVE_ILLEGAL_DESTINATION", `Unit cannot enter ${toRegion}`));
    } else if (state.movableStackCount(factionId, fromRegion, unitTypeId) < count) {
      result.errors.push(
        MoveError.of("MOVE_ALREADY_MOVED", `Units already moved this phase from ${fromRegion}`),
      );
    } else if (this.availableStackCount(fromRegion, factionId, unitTypeId, state) < count) {
      result.errors.push(
        MoveError.of("MOVE_INSUFFICIENT_UNITS", `Not enough ${unitTypeId} in ${fromRegion}`),
      );
    }

    result.ok = result.errors.length === 0;
    return result;
  }

  private availableStackCount(regionId: string, factionId: string, unitTypeId: string, state: GameState): number {
    let total = 0;
    for (const entry of state.getFactionUnitsInRegion(regionId, factionId)) {
      if (String(entry.unit_type_id ?? "") === unitTypeId && !("instance_id" in entry)) {
        total += Math.trunc(Number(entry.count ?? 0));
      }
    }
    return total;
  }

  private instanceRegion(instanceId: string, state: GameState): string {
    return String(state.transport_instances[instanceId]?.region_id ?? "");
  }

  private instanceUnitType(instanceId: string, state: GameState): string {
    return String(state.transport_instances[instanceId]?.unit_type_id ?? "");
  }

  validateNonCombatMovementBatch(
    batch: NonCombatMovementBatch,
    state: GameState,
    _ruleset: Ruleset,
    planeDependencies: Record<string, { possible_landing_regions: unknown[] } | null>,
  ): ValidationResult {
    const result = new ValidationResult();
    const checker = new CarrierConstraintChecker();
    const carrierResult = checker.validateCarrierMovesWithPlaneDependencies(batch, state, planeDependencies);
    if (!carrierResult.ok) {
      result.errors = result.errors.concat(carrierResult.errors);
    }
    result.ok = result.errors.length === 0;
    return result;
  }

  /** Returns true on the first non-friendly entry with count > 0, and false if that first entry is empty. */
  private regionHasEnemyUnits(regionId: string, factionId: string, state: GameState): boolean {
    for (const entry of state.getUnitsInRegion(regionId)) {
      if (String(entry.faction_id ?? "") !== factionId) {
        return Math.trunc(Number(entry.count ?? 0)) > 0;
      }
    }
    return false;
  }

  floodFill(start: string, range: number, state: GameState, seaOnly = false, factionId = ""): string[] {
    const visited: Record<string, boolean> = {};
    const frontier: { region: string; dist: number }[] = [{ region: start, dist: 0 }];
    const result: string[] = [];

    while (frontier.length > 0) {
      const current = frontier.shift()!;
      const region = current.region;
      const dist = current.dist;

      if (dist > range) {
        continue;
      }
      if (visited[region]) {
        continue;
      }

      const regionObj = state.regions[region];
      if (seaOnly && regionObj != null && !regionObj.isSeaRegion()) {
        continue;
      }

      visited[region] = true;

      if (region !== start) {
        result.push(region);
      }

      if (factionId !== "" && this.regionHasEnemyUnits(region, factionId, state)) {
        continue;
      }

      for (const n of state.getAdjacentRegions(region)) {
        if (seaOnly) {
          const neighbor = state.regions[n];
          if (neighbor == null || !neighbor.isSeaRegion()) {
            continue;
          }
        }
        frontier.push({ region: n, dist: dist + 1 });
      }
    }
    return result;
  }
}
