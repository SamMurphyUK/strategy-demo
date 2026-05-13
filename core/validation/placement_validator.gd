extends RefCounted

const VT := preload("res://core/validation/validation_types.gd")

func validate_placement_batch(batch: PlacementBatch, state: GameState, ruleset: Ruleset) -> VT.ValidationResult:
	var result := VT.ValidationResult.new()

	for placement in batch.placements:
		var region: String = placement.region
		var unit_type: String = placement.unit_type

		if not state.is_region_owned_by(region, state.current_faction_id):
			var err := VT.MoveError.new()
			err.code = "CANNOT_PLACE_IN_UNOWNED_REGION"
			err.message = "Cannot place %s in %s." % [unit_type, region]
			result.errors.append(err)
			continue

	result.ok = result.errors.is_empty()
	return result
