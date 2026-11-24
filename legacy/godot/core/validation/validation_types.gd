extends RefCounted

# Standalone requirement class
const PlaneLandingRequirement = preload("res://core/validation/plane_landing_requirement.gd")

# -----------------------------
# Error + Result Types
# -----------------------------

class MoveError:
	var code: String = ""
	var message: String = ""
	var context: Dictionary = {}

class ValidationResult:
	var ok: bool = false
	var errors: Array[MoveError] = []

class CombatMovementValidationResult:
	var ok: bool = false
	var errors: Array[MoveError] = []
	var plane_landing_dependencies: Dictionary = {}

# -----------------------------
# Movement Preview Types
# -----------------------------

class UnitMovePreview:
	var legal_regions: Array[String] = []
	var illegal_regions: Dictionary = {}
	var special_actions: Array = []

# -----------------------------
# Combat Movement Types
# -----------------------------

class CombatMove:
	var unit_id: int = 0
	var from_region: String = ""
	var to_region: String = ""
	var path: Array[String] = []
	var is_amphibious: bool = false
	var is_bombing: bool = false

class CombatMovementBatch:
	var moves: Array[CombatMove] = []

# -----------------------------
# Non‑Combat Movement Types
# -----------------------------

class NonCombatMove:
	var unit_id: int = 0
	var from_region: String = ""
	var to_region: String = ""
	var path: Array[String] = []

class NonCombatMovementBatch:
	var moves: Array[NonCombatMove] = []

# -----------------------------
# Special Actions
# -----------------------------

class SpecialAction:
	var action_type: String = ""
	var target_region: String = ""
	var extra: Dictionary = {}

# -----------------------------
# Plane Landing Dependency (missing class restored)
# -----------------------------

class PlaneLandingDependency:
	var plane_id: int = 0
	var possible_landing_regions: Array[String] = []
