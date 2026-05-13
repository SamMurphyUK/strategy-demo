extends RefCounted
class_name ValidationTypes

class MoveError:
	extends RefCounted
	var code: String
	var message: String
	var context: Dictionary = {}

class ValidationResult:
	extends RefCounted
	var ok: bool = false
	var errors: Array[MoveError] = []

class UnitMovePreview:
	extends RefCounted
	var legal_regions: Array[String] = []
	var illegal_regions: Dictionary = {}
	var special_actions: Array = []

class CombatMove:
	extends RefCounted
	var unit_id: int
	var from_region: String
	var to_region: String
	var path: Array[String] = []
	var is_amphibious: bool = false
	var is_bombing: bool = false

class CombatMovementBatch:
	extends RefCounted
	var moves: Array[CombatMove] = []

class NonCombatMove:
	extends RefCounted
	var unit_id: int
	var from_region: String
	var to_region: String
	var path: Array[String] = []

class NonCombatMovementBatch:
	extends RefCounted
	var moves: Array[NonCombatMove] = []

class PlaneLandingDependency:
	extends RefCounted
	var plane_id: int
	var possible_landing_regions: Array[String] = []
	var dependent_carrier_ids: Array[int] = []
	var requires_carrier_movement: bool = false
	var requires_territory_capture: bool = false
	var requires_airbase: bool = false

class CombatMovementValidationResult:
	extends RefCounted
	var ok: bool = false
	var errors: Array[MoveError] = []
	var plane_landing_dependencies: Dictionary = {}

class SpecialAction:
	extends RefCounted
	var action_type: String
	var target_region: String
	var extra: Dictionary = {}
