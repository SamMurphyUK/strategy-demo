extends RefCounted
class_name PlaneLandingDependencySolver

const VT := preload("res://core/validation/validation_types.gd")

func compute_plane_dependencies(batch: Array, state: GameState, ruleset: Ruleset) -> Dictionary:
	var result: Dictionary = {}

	# 1. Collect all fighter moves in the batch
	for move in batch:
		if move.unit_type_id != "fighter":
			continue

		var plane_id: int = int(move.unit_id)
		var start_region: String = state.get_unit_region(plane_id)

		var possible: Array = _compute_landing_regions_for_plane(
			plane_id,
			start_region,
			state,
			ruleset
		)

		var dep := VT.PlaneLandingDependency.new()
		dep.plane_id = plane_id
		dep.possible_landing_regions = possible

		result[plane_id] = dep

	return result


func _compute_landing_regions_for_plane(
	plane_id: int,
	start_region: String,
	state: GameState,
	ruleset: Ruleset
) -> Array:

	var possible: Array = []
	var neighbors: Array = state.get_adjacent_regions(start_region)

	# 2. Check adjacent carriers
	for region_value in neighbors:
		var region: String = String(region_value)
		if state.region_has_friendly_carrier(region):
			possible.append(region)

	# 3. Check land regions
	for region_value in neighbors:
		var region: String = String(region_value)
		if ruleset.can_unit_land_on_region("fighter", region, state):
			possible.append(region)

	return possible
