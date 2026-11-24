class_name PlaneLandingDependencySolverV2
extends RefCounted

const VT := preload("res://core/validation/validation_types.gd")
const PlaneLandingRequirement := preload("res://core/validation/plane_landing_requirement.gd")

func compute_plane_dependencies(
		batch: VT.CombatMovementBatch,
		state: GameState,
		ruleset: Ruleset
	) -> Dictionary:

	var deps: Dictionary = {}   # plane_id (String) -> PlaneLandingRequirement

	for move in batch.moves:
		var unit: Dictionary = state.get_unit(move.unit_id)
		if unit == null:
			continue

		if unit.get("unit_type") not in ["fighter", "bomber"]:
			continue

		var req := PlaneLandingRequirement.new()
		req.unit_id = move.unit_id
		req.from_region = move.from_region
		req.to_region = move.to_region
		req.possible_landing_regions = _compute_possible_landing_regions(unit, state, ruleset)

		deps[str(move.unit_id)] = req

	return deps


func _compute_possible_landing_regions(
		unit: Dictionary,
		state: GameState,
		ruleset: Ruleset
	) -> Array[String]:

	var result: Array[String] = []
	var move_range: int = ruleset.get_unit_move_range(unit["unit_type"])

	var frontier: Array[String] = [unit["region"]]
	var visited: Dictionary = { unit["region"]: true }
	var depth := 0

	while depth < move_range:
		var next_frontier: Array[String] = []

		for region in frontier:
			for adj in state.get_adjacent_regions(region):
				if not visited.has(adj):
					visited[adj] = true
					next_frontier.append(adj)

		frontier = next_frontier
		depth += 1

	for region in visited.keys():
		result.append(region)

	return result
