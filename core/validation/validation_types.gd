extends RefCounted

# Import the renamed standalone class
const PlaneLandingRequirement = preload("res://core/validation/plane_landing_requirement.gd")


# All your other inner classes remain unchanged
class MoveError:
	var code: String = ""
	var message: String = ""
	var context: Dictionary = {}

class ValidationResult:
	var ok: bool = false
	var errors: Array[MoveError] = []

class UnitMovePreview:
	var legal_regions: Array[String] = []
	var illegal_regions: Dictionary = {}
	var special_actions: Array = []

class CombatMove:
	var unit_id: int = 0
	var from_region: String = ""
	var to_region: String = ""
	var path: Array[String] = []
	var is_amphibious: bool = false
	var is_bombing: bool = false

class CombatMovementBatch:
	var moves: Array[CombatMove] = []

class NonCombatMove:
	var unit_id: int = 0
	var from_region: String = ""
	var to_region: String = ""
	var path: Array[String] = []

class NonCombatMovementBatch:
	var moves: Array[NonCombatMove] = []

class CombatMovementValidationResult:
	var ok: bool = false
	var errors: Array[MoveError] = []
	var plane_landing_dependencies: Dictionary = {}

class SpecialAction:
	var action_type: String = ""
	var target_region: String = ""
	var extra: Dictionary = {}
