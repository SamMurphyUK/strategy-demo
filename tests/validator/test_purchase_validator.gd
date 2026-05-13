extends GutTest

const Validator := preload("res://core/validation/purchase_validator.gd")
const VT := preload("res://core/validation/validation_types.gd")
const TestStateBuilder := preload("res://tests/validator/helpers/test_state_builder.gd")

func test_purchase_exceeds_ipc():
	var builder := TestStateBuilder.new()
	var state := builder.build_state()
	state.current_ipc = 5

	var ruleset := builder.build_ruleset()
	ruleset.unit_defs = {
		"tank": { "cost": 6 }
	}

	var batch := {
		"items": [
			{ "unit_type": "tank", "count": 1 }
		]
	}

	var validator := Validator.new()
	var result := validator.validate_purchase_batch(batch, state, ruleset)

	assert_false(result.ok)
	assert_eq(result.errors.size(), 1)
