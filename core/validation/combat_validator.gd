extends RefCounted

const VT := preload("res://core/validation/validation_types.gd")

func validate_combat(batch: VT.CombatMovementBatch, state: GameState, ruleset: Ruleset) -> VT.CombatMovementValidationResult:
	var result := VT.CombatMovementValidationResult.new()

	# Future combat logic goes here

	result.ok = result.errors.is_empty()
	return result
