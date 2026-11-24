extends RefCounted

const VT := preload("res://core/validation/validation_types.gd")
const PlaneLandingRequirement := preload("res://core/validation/plane_landing_requirement.gd")

func validate_carrier_moves_with_plane_dependencies(
		batch: VT.NonCombatMovementBatch,
		state: GameState,
		plane_dependencies: Dictionary
	) -> VT.ValidationResult:

	var result: VT.ValidationResult = VT.ValidationResult.new()
	var carrier_positions: Dictionary = _simulate_carrier_positions(batch, state)

	for plane_id in plane_dependencies.keys():
		var dep = plane_dependencies[plane_id]
		if dep == null:
			continue

		var valid := false

		for region_value in dep.possible_landing_regions:
			var region: String = str(region_value)
			if _region_is_valid_landing(region, carrier_positions, state):
				valid = true
				break

		if not valid:
			var err: VT.MoveError = VT.MoveError.new()
			err.code = "PLANE_STRANDED"
			err.message = "Carrier movement would leave fighter %s without a landing spot." % plane_id
			result.errors.append(err)

	result.ok = result.errors.is_empty()
	return result


func _simulate_carrier_positions(batch: VT.NonCombatMovementBatch, state: GameState) -> Dictionary:
	var positions: Dictionary = {}  # carrier_id -> region

	for move in batch.moves:
		var unit: Dictionary = state.get_unit(move.unit_id)
		if typeof(unit) != TYPE_DICTIONARY:
			continue

		var unit_type_id: String = str(unit.get("unit_type_id", ""))
		var unit_region: String = str(unit.get("region", ""))
		var unit_id_str: String = str(unit.get("id", ""))

		if unit_type_id == "carrier":
			positions[unit_id_str] = str(move.to_region)
		else:
			positions[unit_id_str] = unit_region

	return positions


func _region_is_valid_landing(region: String, carrier_positions: Dictionary, state: GameState) -> bool:
	if state.is_region_land(region) and state.is_region_owned_by(region, state.current_faction_id):
		return true

	for carrier_id in carrier_positions.keys():
		var carrier_region: String = str(carrier_positions[carrier_id])
		if carrier_region == region:
			return true

	return false
