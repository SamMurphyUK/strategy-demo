extends RefCounted
class_name MovementValidator

const VT := preload("res://core/validation/validation_types.gd")
const PlaneLandingDependencySolverScript := preload("res://core/validation/plane_landing_dependency_solver.gd")
const CarrierConstraintCheckerScript := preload("res://core/validation/carrier_constraint_checker.gd")

func get_legal_moves_for_unit(unit_id: int, state: GameState, ruleset: Ruleset) -> VT.UnitMovePreview:
	var preview: VT.UnitMovePreview = VT.UnitMovePreview.new()

	var unit: Dictionary = state.get_unit(unit_id)
	if typeof(unit) != TYPE_DICTIONARY:
		return preview

	var start: String = String(unit.get("region", ""))
	if start == "":
		return preview

	var unit_type_id: String = String(unit.get("unit_type_id", ""))
	var move_range: int = ruleset.get_unit_move_range(unit_type_id, state)

	var sea_only := ruleset.is_sea_unit(unit_type_id, state)
	var reachable: Array = _flood_fill(start, move_range, state, sea_only, str(unit.get("faction_id", "")))

	for region_value in reachable:
		var region: String = String(region_value)
		if ruleset.can_unit_enter_region(unit_type_id, region, state, state.current_phase):
			preview.legal_regions.append(region)
		else:
			preview.illegal_regions[region] = "ILLEGAL_DESTINATION"

	return preview


func get_legal_destinations_for_stack(
	from_region: String,
	unit_type_id: String,
	faction_id: String,
	state: GameState,
	ruleset: Ruleset
) -> Array[String]:
	var legal: Array[String] = []
	if from_region.is_empty() or unit_type_id.is_empty():
		return legal
	if state.movable_stack_count(faction_id, from_region, unit_type_id) <= 0:
		return legal
	var move_range := ruleset.get_unit_move_range(unit_type_id, state)
	if move_range <= 0:
		move_range = 1
	var sea_only := ruleset.is_sea_unit(unit_type_id, state)
	for dest_value in _flood_fill(from_region, move_range, state, sea_only, faction_id):
		var dest := str(dest_value)
		if ruleset.can_unit_enter_region(unit_type_id, dest, state, state.current_phase):
			legal.append(dest)
	return legal


func get_legal_destinations_for_instance(
	instance_id: String,
	faction_id: String,
	state: GameState,
	ruleset: Ruleset
) -> Array[String]:
	var legal: Array[String] = []
	if instance_id.is_empty() or state.has_instance_moved(instance_id):
		return legal
	var from_region := _instance_region(instance_id, state)
	if from_region.is_empty():
		return legal
	var unit_type_id := _instance_unit_type(instance_id, state)
	if unit_type_id.is_empty():
		return legal
	var move_range := ruleset.get_unit_move_range(unit_type_id, state)
	if move_range <= 0:
		move_range = 1
	var sea_only := ruleset.is_sea_unit(unit_type_id, state)
	for dest_value in _flood_fill(from_region, move_range, state, sea_only, faction_id):
		var dest := str(dest_value)
		if ruleset.can_unit_enter_region(unit_type_id, dest, state, state.current_phase):
			legal.append(dest)
	return legal


func validate_instance_move(
	from_region: String,
	to_region: String,
	instance_id: String,
	faction_id: String,
	state: GameState,
	ruleset: Ruleset
) -> VT.ValidationResult:
	var result := VT.ValidationResult.new()
	var unit_type_id := _instance_unit_type(instance_id, state)
	if unit_type_id.is_empty():
		result.errors.append(_move_error("MOVE_INVALID", "Unknown ship instance"))
	elif from_region.is_empty() or to_region.is_empty():
		result.errors.append(_move_error("MOVE_INVALID", "Missing from/to region"))
	elif from_region == to_region:
		result.errors.append(_move_error("MOVE_INVALID", "Cannot move to the same region"))
	elif state.has_instance_moved(instance_id):
		result.errors.append(_move_error("MOVE_ALREADY_MOVED", "Ship already moved this phase"))
	elif _instance_region(instance_id, state) != from_region:
		result.errors.append(_move_error("MOVE_INVALID", "Ship is not in %s" % from_region))
	elif not state.is_adjacent(from_region, to_region) and to_region not in _flood_fill(
		from_region,
		ruleset.get_unit_move_range(unit_type_id, state),
		state,
		ruleset.is_sea_unit(unit_type_id, state),
		faction_id
	):
		result.errors.append(_move_error("MOVE_OUT_OF_RANGE", "Destination is out of movement range"))
	elif not ruleset.can_unit_enter_region(unit_type_id, to_region, state, state.current_phase):
		result.errors.append(_move_error("MOVE_ILLEGAL_DESTINATION", "Ship cannot enter %s" % to_region))
	result.ok = result.errors.is_empty()
	return result


func validate_stack_move(
	from_region: String,
	to_region: String,
	unit_type_id: String,
	faction_id: String,
	count: int,
	state: GameState,
	ruleset: Ruleset
) -> VT.ValidationResult:
	var result := VT.ValidationResult.new()

	if from_region.is_empty() or to_region.is_empty():
		result.errors.append(_move_error("MOVE_INVALID", "Missing from/to region"))
	elif from_region == to_region:
		result.errors.append(_move_error("MOVE_INVALID", "Cannot move to the same region"))
	elif not state.is_adjacent(from_region, to_region) and to_region not in _flood_fill(
		from_region,
		ruleset.get_unit_move_range(unit_type_id, state),
		state,
		ruleset.is_sea_unit(unit_type_id, state),
		faction_id
	):
		result.errors.append(_move_error("MOVE_OUT_OF_RANGE", "Destination is out of movement range"))
	elif not ruleset.can_unit_enter_region(unit_type_id, to_region, state, state.current_phase):
		result.errors.append(_move_error("MOVE_ILLEGAL_DESTINATION", "Unit cannot enter %s" % to_region))
	elif state.movable_stack_count(faction_id, from_region, unit_type_id) < count:
		result.errors.append(
			_move_error("MOVE_ALREADY_MOVED", "Units already moved this phase from %s" % from_region)
		)
	elif _available_stack_count(from_region, faction_id, unit_type_id, state) < count:
		result.errors.append(_move_error("MOVE_INSUFFICIENT_UNITS", "Not enough %s in %s" % [unit_type_id, from_region]))

	result.ok = result.errors.is_empty()
	return result


func _available_stack_count(
	region_id: String,
	faction_id: String,
	unit_type_id: String,
	state: GameState
) -> int:
	var total := 0
	for entry in state.get_faction_units_in_region(region_id, faction_id):
		if str(entry.get("unit_type_id", "")) == unit_type_id and not entry.has("instance_id"):
			total += int(entry.get("count", 0))
	return total


func _move_error(code: String, message: String) -> VT.MoveError:
	var err := VT.MoveError.new()
	err.code = code
	err.message = message
	return err


func _instance_region(instance_id: String, state: GameState) -> String:
	return str(state.transport_instances.get(instance_id, {}).get("region_id", ""))


func _instance_unit_type(instance_id: String, state: GameState) -> String:
	return str(state.transport_instances.get(instance_id, {}).get("unit_type_id", ""))


func validate_combat_movement_batch(batch, state: GameState, ruleset: Ruleset):
	var result: VT.CombatMovementValidationResult = VT.CombatMovementValidationResult.new()

	var solver = PlaneLandingDependencySolverScript.new()
	result.plane_landing_dependencies = solver.call("compute_plane_dependencies", batch, state, ruleset)

	for plane_id in result.plane_landing_dependencies.keys():
		var dep = result.plane_landing_dependencies[plane_id]
		if dep == null:
			continue

		if dep.possible_landing_regions.is_empty():
			var err: VT.MoveError = VT.MoveError.new()
			err.code = "NO_LANDING_SPOT"
			err.message = "Fighter %s has no legal landing options after combat movement." % plane_id
			result.errors.append(err)

	result.ok = result.errors.is_empty()
	return result


func validate_non_combat_movement_batch(batch, state: GameState, ruleset: Ruleset, plane_dependencies: Dictionary):
	var result: VT.ValidationResult = VT.ValidationResult.new()

	var checker = CarrierConstraintCheckerScript.new()
	var carrier_result = checker.call("validate_carrier_moves_with_plane_dependencies", batch, state, plane_dependencies)

	if not carrier_result.ok:
		result.errors += carrier_result.errors

	result.ok = result.errors.is_empty()
	return result


func _region_has_enemy_units(region_id: String, faction_id: String, state: GameState) -> bool:
	for entry in state.get_units_in_region(region_id):
		if str(entry.get("faction_id", "")) != faction_id:
			return int(entry.get("count", 0)) > 0
	return false


func _flood_fill(
	start: String,
	range: int,
	state: GameState,
	sea_only: bool = false,
	faction_id: String = ""
) -> Array:
	var visited: Dictionary = {}
	var frontier: Array = [{"region": start, "dist": 0}]
	var result: Array = []

	while frontier.size() > 0:
		var raw: Variant = frontier.pop_front()
		var current: Dictionary = Dictionary(raw)

		var region: String = String(current["region"])
		var dist: int = int(current["dist"])

		if dist > range:
			continue
		if visited.has(region):
			continue

		var region_obj: Region = state.regions.get(region)
		if sea_only and region_obj != null and not region_obj.is_sea_region():
			continue

		visited[region] = true

		if region != start:
			result.append(region)

		var can_continue := true
		if not faction_id.is_empty() and _region_has_enemy_units(region, faction_id, state):
			can_continue = false

		if not can_continue:
			continue

		var neighbors: Array = state.get_adjacent_regions(region)
		for n_value in neighbors:
			var n: String = String(n_value)
			if sea_only:
				var neighbor: Region = state.regions.get(n)
				if neighbor == null or not neighbor.is_sea_region():
					continue
			frontier.append({"region": n, "dist": dist + 1})

	return result
