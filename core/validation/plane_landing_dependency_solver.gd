extends RefCounted

const VT := preload("res://core/validation/validation_types.gd")

func compute_plane_dependencies(batch: VT.CombatMovementBatch, state: GameState, ruleset: Ruleset) -> Dictionary:
	var deps := {}  # plane_id (String) -> PlaneLandingDependency

	for move in batch.moves:
		var unit: Unit = state.get_unit(move.unit_id) as Unit
		if unit == null:
			continue
		if not _is_fighter(unit, ruleset):
			continue

		var dep := VT.PlaneLandingDependency.new()
		dep.plane_id = unit.id

		var move_range: int = ruleset.get_unit_move_range(unit.unit_type)
		var reachable: Array[String] = _flood_fill(move.to_region, move_range, state)

		for region in reachable:
			if _is_friendly_land(region, state):
				dep.possible_landing_regions.append(region)

		var carriers := _get_friendly_carriers(state)
		for carrier in carriers:
			if state.is_unit_in_combat(carrier.id):
				continue

			var carrier_range: int = ruleset.get_unit_move_range("carrier")
			var carrier_reachable: Array[String] = _flood_fill(carrier.region, carrier_range, state)

			for region in reachable:
				if region in carrier_reachable:
					dep.possible_landing_regions.append(region)
					dep.dependent_carrier_ids.append(carrier.id)
					dep.requires_carrier_movement = true
					break

		# Store using STRING key to avoid int/String mismatch
		deps[str(unit.id)] = dep

	return deps


func _is_fighter(unit: Unit, ruleset: Ruleset) -> bool:
	var def := ruleset.get_unit_def(unit.unit_type)
	return def.get("is_air", false) and unit.unit_type == "fighter"


func _is_friendly_land(region: String, state: GameState) -> bool:
	return state.is_region_land(region) and state.is_region_owned_by(region, state.current_faction_id)


func _get_friendly_carriers(state: GameState) -> Array:
	var out := []
	var units := state.get_units_for_faction(state.current_faction_id)
	for u in units:
		if u.unit_type == "carrier":
			out.append(u)
	return out


func _flood_fill(start: String, range: int, state: GameState) -> Array[String]:
	var visited := {}
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
