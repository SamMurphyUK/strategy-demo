extends GutTest

const MovementValidator := preload("res://core/validation/movement_validator.gd")
const VT := preload("res://core/validation/validation_types.gd")
const TestStateBuilder := preload("res://tests/validator/helpers/test_state_builder.gd")

func test_basic_movement_range():
	var builder := TestStateBuilder.new()
	builder.with_region("A").with_region("B").with_region("C")
	builder.with_adjacent("A", "B").with_adjacent("B", "C")
	builder.with_unit(1, "infantry", "A")

	var state := builder.build_state()
	var ruleset := builder.build_ruleset()
	ruleset.unit_move_ranges = { "infantry": 2 }

	var validator := MovementValidator.new()
	var preview := validator.get_legal_moves_for_unit(1, state, ruleset)

	assert_true("B" in preview.legal_regions)
	assert_true("C" in preview.legal_regions)
