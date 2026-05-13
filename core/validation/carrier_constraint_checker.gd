extends RefCounted

const VT := preload("res://core/validation/validation_types.gd")

func validate_carrier_moves_with_plane_dependencies(
		batch: VT.NonCombatMovementBatch,
		state: GameState,
		plane_dependencies: Dictionary
	) -> VT.ValidationResult:

	var result := VT.ValidationResult.new()
	var carrier_positions := _simulate_carrier_positions(batch, state)

	for plane_id in plane_dependencies.keys():
		var dep: VT.PlaneLandingDependency = plane_dependencies[plane_id] as VT.PlaneLandingDependency
		if dep == null:
			continue

		var valid := false

		for region in dep.possible_landing_regions:
			if _region_is_valid_landing(region, carrier_positions, state):
				valid = true
				break

		if not valid:
			var err := VT.MoveError.new()
			err.code = "PLANE_STRANDED"
			err.message = "Carrier movement would leave fighter %s without a landing spot." % plane_id
			result.errors.append(err)

	result.ok = result.errors.is_empty()
	return result


func _simulate_carrier_positions(batch: VT.NonCombatMovementBatch, state: GameState) -> Dictionary:
	var positions := {}  # carrier_id (String) -> region (String)

	for move in batch.moves:
		var unit: Unit = state.get_unit(move.unit_id) as Unit
		if unit == null:
			continue

		if unit.unit_type == "carrier":
			positions[str(unit.id)] = move.to_region
		else:
			positions[str(unit.id)] = unit.region

	return positions


func _region_is_valid_landing(region: String, carrier_positions: Dictionary, state: GameState) -> bool:
	if state.is_region_land(region) and state.is_region_owned_by(region, state.current_faction_id):
		return true

	for carrier_id in carrier_positions.keys():
		var carrier_region: String = carrier_positions[carrier_id]
		if carrier_region == region:
			return true

	return false
