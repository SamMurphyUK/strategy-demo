extends RefCounted
class_name ValidationTypes

# Fires when the file is loaded
func _init():
	print(">>> Loaded validation_types.gd (THIS FILE WAS USED)")

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
	var plane_id: int = 0
	var possible_landing_regions: Array[String] = []
	var dependent_carrier_ids: Array[int] = []
	var requires_carrier_movement: bool = false
	var requires_territory_capture: bool = false
	var requires_airbase: bool = false

	# Fires when the dependency object is created
	func _init():
		print(">>> Constructed PlaneLandingDependency. Fields present: ", self)

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
