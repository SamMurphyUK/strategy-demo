extends GutTest

const Validator := preload("res://core/validation/placement_validator.gd")
const VT := preload("res://core/validation/validation_types.gd")
const TestStateBuilder := preload("res://tests/validator/helpers/test_state_builder.gd")

func test_cannot_place_in_enemy_region():
	var builder := TestStateBuilder.new()
	builder.with_region("A", true, "blue")

	var state := builder.build_state()
	var ruleset := builder.build_ruleset()

	var batch := {
		"placements": [
			{ "region": "A", "unit_type": "infantry" }
		]
	}

	# Instantiate validator and inject state
	var validator: PlacementValidator = Validator.new()
	validator.state = state

	# Call the corrected batch method
	var result: VT.ValidationResult = validator.validate_placement_batch(batch, ruleset)

	assert_false(result.ok)
	assert_eq(result.errors.size(), 1)
