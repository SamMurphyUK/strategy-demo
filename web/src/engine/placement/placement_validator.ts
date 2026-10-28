import type { GameState } from "../model/game_state";
import type { Region } from "../model/region";
import type { Dict } from "../model/types";
import type { Ruleset } from "../rules/ruleset";
import { MoveError, ValidationResult } from "../validation/validation_types";

export interface PlacementCheck {
  valid: boolean;
  errors: string[];
}

export class PlacementValidator {
  constructor(public state: GameState | null = null) {}

  // ---------------------------------------------------------
  // SINGLE-PLACEMENT VALIDATION
  // ---------------------------------------------------------

  validatePlacement(factionId: string, regionId: string, unitTypeId: string, count = 1): PlacementCheck {
    const state = this.state!;
    const result: PlacementCheck = { valid: true, errors: [] };

    const region = state.regions[regionId];
    if (region == null) {
      result.valid = false;
      result.errors.push(`Region does not exist: ${regionId}`);
      return result;
    }
    if (!region.has_factory) {
      result.valid = false;
      result.errors.push(`Region has no factory: ${regionId}`);
      return result;
    }
    if (region.owner_faction_id !== factionId) {
      result.valid = false;
      result.errors.push(`Region not owned by faction: ${regionId}`);
      return result;
    }
    const u = state.unit_types[unitTypeId];
    if (u == null) {
      result.valid = false;
      result.errors.push(`Unknown unit type: ${unitTypeId}`);
      return result;
    }

    const capacity = this.getFactoryCapacity(region);
    const alreadyPlaced = this.getPlacedCount(factionId, regionId);
    if (alreadyPlaced + count > capacity) {
      result.valid = false;
      result.errors.push(`Exceeds factory capacity: ${alreadyPlaced} + ${count} > ${capacity}`);
    }
    return result;
  }

  // ---------------------------------------------------------
  // BATCH-LEVEL VALIDATION
  // ---------------------------------------------------------

  /** batch: { placements: [{ region, unit_type, count? }] } */
  validatePlacementBatch(batch: Dict, _ruleset: Ruleset): ValidationResult {
    const result = new ValidationResult();
    const factionId = this.state!.current_faction_id;

    for (const entry of (batch.placements ?? []) as Dict[]) {
      const regionId: string = entry.region ?? "";
      const unitType: string = entry.unit_type ?? "";
      const count: number = entry.count ?? 1;

      const single = this.validatePlacement(factionId, regionId, unitType, count);
      if (!single.valid) {
        for (const msg of single.errors) {
          result.errors.push(MoveError.of("INVALID_PLACEMENT", msg));
        }
      }
    }

    result.ok = result.errors.length === 0;
    return result;
  }

  // ---------------------------------------------------------
  // INTERNAL HELPERS
  // ---------------------------------------------------------

  private getFactoryCapacity(region: Region): number {
    let capacity = region.ipc_value;
    const rules = this.state!.rules;
    if (region.is_capital && (rules.capital_production_bonus ?? false)) {
      capacity += rules.capital_bonus_amount ?? 2;
    }
    return capacity;
  }

  private getPlacedCount(factionId: string, regionId: string): number {
    const pending: Dict[] = this.state!.pending_purchases[factionId] ?? [];
    let count = 0;
    for (const p of pending) {
      if (p.placed_region_id === regionId) {
        count += p.count ?? 1;
      }
    }
    return count;
  }

  getValidPlacementRegions(factionId: string): string[] {
    const state = this.state!;
    const regions: string[] = [];
    for (const regionId of Object.keys(state.regions)) {
      const region = state.regions[regionId];
      if (region.owner_faction_id === factionId && region.has_factory) {
        regions.push(regionId);
      }
    }
    return regions;
  }
}
