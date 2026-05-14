extends RefCounted
class_name MovementValidator

const VT := preload("res://core/validation/validation_types.gd")
const PlaneLandingDependencySolverScript := preload("res://core/validation/plane_landing_dependency_solver.gd")
const CarrierConstraintCheckerScript := preload("res://core/validation/carrier_constraint_checker.gd")

func get_legal_moves_for_unit(unit_id: int, state: GameState, ruleset: Ruleset) -> VT.UnitMovePreview:
	var preview := VT.UnitMovePreview.new()

	var unit: Unit = state.get_unit(unit_id) as Unit
	if unit == null:
		return preview

	var start: String = unit.region
	var range: int = ruleset.get_unit_move_range(unit.unit_type)
	var reachable: Array[String] = _flood_fill(start, range, state)

	for region in reachable:
		if ruleset.can_unit_enter_region(unit.unit_type, region, state, state.current_phase):
			preview.legal_regions.append(region)
		else:
			preview.illegal_regions[region] = "ILLEGAL_DESTINATION"

	return preview


func validate_combat_movement_batch(
		batch: VT.CombatMovementBatch,
		state: GameState,
		ruleset: Ruleset
	) -> VT.CombatMovementValidationResult:

	var result := VT.CombatMovementValidationResult.new()

	var solver = PlaneLandingDependencySolverScript.new()
	result.plane_landing_dependencies = solver.call("compute_plane_dependencies", batch, state, ruleset)

	for plane_id in result.plane_landing_dependencies.keys():
		var dep: PlaneLandingRequirement = result.plane_landing_dependencies[plane_id] as PlaneLandingRequirement
		if dep == null:
			continue

		if dep.possible_landing_regions.is_empty():
			var err := VT.MoveError.new()
			err.code = "NO_LANDING_SPOT"
			err.message = "Fighter %s has no legal landing options after combat movement." % plane_id
			result.errors.append(err)

	result.ok = result.errors.is_empty()
	return result


func validate_non_combat_movement_batch(
		batch: VT.NonCombatMovementBatch,
		state: GameState,
		ruleset: Ruleset,
		plane_dependencies: Dictionary
	) -> VT.ValidationResult:

	var result := VT.ValidationResult.new()

	var checker = CarrierConstraintCheckerScript.new()
	var carrier_result = checker.call("validate_carrier_moves_with_plane_dependencies", batch, state, plane_dependencies)

	if not carrier_result.ok:
		result.errors += carrier_result.errors

	result.ok = result.errors.is_empty()
	return result


func _flood_fill(start: String, range: int, state: GameState) -> Array[String]:
	var visited := {}  # region -> bool
	var frontier: Array[Dictionary] = [ { "region": start, "dist": 0 } ]
	var result: Array[String] = []

	while frontier.size() > 0:
		var current: Dictionary = frontier.pop_front()

		var region: String = current["region"]
		var dist: int = current["dist"]

		if dist > range:
			continue
		if visited.has(region):
			continue

		visited[region] = true

		if region != start:
			result.append(region)

		var neighbors: Array[String] = state.get_adjacent_regions(region)
		for n in neighbors:
			frontier.append({ "region": n, "dist": dist + 1 })

	return result
