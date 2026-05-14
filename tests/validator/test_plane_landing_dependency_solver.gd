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
		var unit: Unit = state.get_unit(move.unit_id)
		if unit == null:
			continue

		if unit.unit_type != "fighter" and unit.unit_type != "bomber":
			continue

		var req := PlaneLandingRequirement.new()
		req.unit_id = move.unit_id
		req.from_region = move.from_region
		req.to_region = move.to_region
		req.possible_landing_regions = _compute_possible_landing_regions(unit, state, ruleset)

		# IMPORTANT FIX: store dependency under STRING key
		deps[str(move.unit_id)] = req

	return deps


func _compute_possible_landing_regions(
		unit: Unit,
		state: GameState,
		ruleset: Ruleset
	) -> Array[String]:

	var result: Array[String] = []
	var move_range := ruleset.get_unit_move_range(unit.unit_type)

	# BFS to find all reachable regions within move range
	var frontier := [unit.region]
	var visited := { unit.region: true }
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

	# All visited regions are potential landing spots
	for region in visited.keys():
		result.append(region)

	return result
