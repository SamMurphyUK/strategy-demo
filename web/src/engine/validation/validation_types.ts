import type { Dict } from "../model/types";

// -----------------------------
// Error + Result Types
// -----------------------------

export class MoveError {
  code = "";
  message = "";
  context: Dict = {};

  static of(code: string, message: string): MoveError {
    const err = new MoveError();
    err.code = code;
    err.message = message;
    return err;
  }
}

export class ValidationResult {
  ok = false;
  errors: MoveError[] = [];
}

export class CombatMovementValidationResult {
  ok = false;
  errors: MoveError[] = [];
  plane_landing_dependencies: Dict = {};
}

// -----------------------------
// Movement Preview Types
// -----------------------------

export class UnitMovePreview {
  legal_regions: string[] = [];
  illegal_regions: Record<string, string> = {};
  special_actions: unknown[] = [];
}

// -----------------------------
// Combat Movement Types
// -----------------------------

export class CombatMove {
  unit_id = 0;
  from_region = "";
  to_region = "";
  path: string[] = [];
  is_amphibious = false;
  is_bombing = false;
}

export class CombatMovementBatch {
  moves: CombatMove[] = [];
}

// -----------------------------
// Non-Combat Movement Types
// -----------------------------

export class NonCombatMove {
  unit_id = 0;
  from_region = "";
  to_region = "";
  path: string[] = [];
}

export class NonCombatMovementBatch {
  moves: NonCombatMove[] = [];
}

// -----------------------------
// Special Actions
// -----------------------------

export class SpecialAction {
  action_type = "";
  target_region = "";
  extra: Dict = {};
}

// -----------------------------
// Plane Landing Dependency
// -----------------------------

export class PlaneLandingDependency {
  plane_id = 0;
  possible_landing_regions: string[] = [];
}
