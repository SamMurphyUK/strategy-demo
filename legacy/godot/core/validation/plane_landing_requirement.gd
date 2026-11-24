extends RefCounted
class_name PlaneLandingRequirement

var unit_instance_id: String = ""
var current_region_id: String = ""
var movement_spent: int = 0
var required_landing: bool = true

var possible_landing_regions: Array = []
var dependent_carrier_ids: Array = []

func _init(
	p_unit_id: String = "",
	p_region_id: String = "",
	p_movement: int = 0
) -> void:
	unit_instance_id = p_unit_id
	current_region_id = p_region_id
	movement_spent = p_movement
