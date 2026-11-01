import type { GameState } from "../model/game_state";
import type { Dict } from "../model/types";
import { MoveError, type NonCombatMovementBatch, ValidationResult } from "../validation/validation_types";

interface LandingDependency {
  possible_landing_regions: unknown[];
}

export class CarrierConstraintChecker {
  validateCarrierMovesWithPlaneDependencies(
    batch: NonCombatMovementBatch,
    state: GameState,
    planeDependencies: Record<string, LandingDependency | null>,
  ): ValidationResult {
    const result = new ValidationResult();
    const carrierPositions = this.simulateCarrierPositions(batch, state);

    for (const planeId of Object.keys(planeDependencies)) {
      const dep = planeDependencies[planeId];
      if (dep == null) {
        continue;
      }

      let valid = false;
      for (const regionValue of dep.possible_landing_regions) {
        if (this.regionIsValidLanding(String(regionValue), carrierPositions, state)) {
          valid = true;
          break;
        }
      }

      if (!valid) {
        result.errors.push(
          MoveError.of(
            "PLANE_STRANDED",
            `Carrier movement would leave fighter ${planeId} without a landing spot.`,
          ),
        );
      }
    }

    result.ok = result.errors.length === 0;
    return result;
  }

  /** carrier_id -> region */
  private simulateCarrierPositions(batch: NonCombatMovementBatch, state: GameState): Record<string, string> {
    const positions: Record<string, string> = {};
    for (const move of batch.moves) {
      const unit: Dict = state.getUnit(move.unit_id);
      const unitTypeId = String(unit.unit_type_id ?? "");
      const unitRegion = String(unit.region ?? "");
      const unitIdStr = String(unit.id ?? "");
      positions[unitIdStr] = unitTypeId === "carrier" ? String(move.to_region) : unitRegion;
    }
    return positions;
  }

  private regionIsValidLanding(region: string, carrierPositions: Record<string, string>, state: GameState): boolean {
    if (state.isRegionLand(region) && state.isRegionOwnedBy(region, state.current_faction_id)) {
      return true;
    }
    for (const carrierId of Object.keys(carrierPositions)) {
      if (String(carrierPositions[carrierId]) === region) {
        return true;
      }
    }
    return false;
  }
}
