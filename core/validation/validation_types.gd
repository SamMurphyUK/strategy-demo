extends RefCounted

# -------------------------
# MoveError
# -------------------------
class MoveError:
	var code: String = ""
	var message: String = ""
	var context: Dictionary = {}

# -------------------------
# ValidationResult
# -------------------------
class ValidationResult:
	var ok: bool = false
	var errors: Array[MoveError] = []

# -------------------------
# UnitMovePreview
# -------------------------
class UnitMovePreview:
	var legal_regions: Array[String] = []
	var illegal_regions: Dictionary = {}
	var special_actions: Array = []

# -------------------------
# CombatMove
# -------------------------
class CombatMove:
	var unit_id: int = 0
	var from_region: String = ""
	var to_region: String = ""
	var path: Array[String] = []
	var is_amphibious: bool = false
	var is_bombing: bool = false

# -------------------------
# CombatMovementBatch
# -------------------------
class CombatMovementBatch:
	var moves: Array[CombatMove] = []

# -------------------------
# NonCombatMove
# -------------------------
class NonCombatMove:
	var unit_id: int = 0
	var from_region: String = ""
	var to_region: String = ""
	var path: Array[String] = []

# -------------------------
# NonCombatMovementBatch
# -------------------------
class NonCombatMovementBatch:
	var moves: Array[NonCombatMove] = []

# -------------------------
# PlaneLandingDependency
# -------------------------
class PlaneLandingDependency:
	var unit_instance_id: String = ""
	var current_region_id: String = ""
	var movement_spent: int = 0
	var required_landing: bool = true

	# MUST have defaults or Godot won't create the fields
	var possible_landing_regions: Array[String] = []
	var dependent_carrier_ids: Array[int] = []

	func _init(p_unit_id: String = "", p_region_id: String = "", p_movement: int = 0) -> void:
		unit_instance_id = p_unit_id
		current_region_id = p_region_id
		movement_spent = p_movement

# -------------------------
# CombatMovementValidationResult
# -------------------------
class CombatMovementValidationResult:
	var ok: bool = false
	var errors: Array[MoveError] = []
	var plane_landing_dependencies: Dictionary = {}

# -------------------------
# SpecialAction
# -------------------------
class SpecialAction:
	var action_type: String = ""
	var target_region: String = ""
	var extra: Dictionary = {}
