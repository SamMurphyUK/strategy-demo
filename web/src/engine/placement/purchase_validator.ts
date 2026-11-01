import type { GameState } from "../model/game_state";
import type { Dict } from "../model/types";
import type { Ruleset } from "../rules/ruleset";
import { MoveError, ValidationResult } from "../validation/validation_types";

export class PurchaseValidator {
  /** batch: { items: [{ unit_type, count }] } */
  validatePurchaseBatch(batch: Dict, state: GameState, ruleset: Ruleset): ValidationResult {
    const result = new ValidationResult();
    let totalCost = 0;

    const items: Dict[] = batch.items ?? [];
    for (const item of items) {
      const unitType: string = item.unit_type ?? "";
      const count: number = item.count ?? 0;

      const def = ruleset.getUnitDef(unitType);
      if (Object.keys(def).length === 0) {
        result.errors.push(MoveError.of("UNKNOWN_UNIT", `Unknown unit type: ${unitType}`));
        continue;
      }
      totalCost += (def.cost ?? 0) * count;
    }

    const factionId = state.current_faction_id;
    const availableIpc = state.ipc[factionId] ?? 0;
    if (totalCost > availableIpc) {
      result.errors.push(MoveError.of("INSUFFICIENT_IPC", "Purchase exceeds available IPC."));
    }

    result.ok = result.errors.length === 0;
    return result;
  }
}
