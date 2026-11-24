extends GutTest

const MovementValidator := preload("res://core/validation/movement_validator.gd")
const VT := preload("res://core/validation/validation_types.gd")
const TestStateBuilder := preload("res://tests/validator/helpers/test_state_builder.gd")

func test_basic_movement_range():
	var builder := TestStateBuilder.new()
	builder.with_region("A").with_region("B").with_region("C")
	builder.with_adjacent("A", "B").with_adjacent("B", "C")
	builder.with_unit_type("infantry", "land", 2)
	builder.with_unit(1, "infantry", "A")

	var state := builder.build_state()
	var ruleset := builder.build_ruleset()
	ruleset.unit_move_ranges = { "infantry": 2 }

	# Correct static typing for the validator instance
	var validator: MovementValidator = MovementValidator.new()

	var preview := validator.get_legal_moves_for_unit(1, state, ruleset)

	assert_true("B" in preview.legal_regions)
	assert_true("C" in preview.legal_regions)


func test_land_unit_cannot_enter_sea_region():
	var builder := TestStateBuilder.new()
	builder.with_region("land_a", true, "red")
	builder.with_region("sea_1", false, "")
	builder.with_adjacent("land_a", "sea_1")
	builder.with_unit_type("infantry", "land", 1)
	builder.with_stack_unit("infantry", "land_a", "red")

	var state := builder.build_state()
	state.current_phase = "combat_move"
	state.current_faction_id = "red"
	var ruleset := builder.build_ruleset()
	var validator: MovementValidator = MovementValidator.new()

	var result := validator.validate_stack_move(
		"land_a", "sea_1", "infantry", "red", 1, state, ruleset
	)
	assert_false(result.ok)
	assert_eq(result.errors[0].code, "MOVE_ILLEGAL_DESTINATION")

	var legal := validator.get_legal_destinations_for_stack(
		"land_a", "infantry", "red", state, ruleset
	)
	assert_false("sea_1" in legal)


func test_noncombat_move_cannot_enter_hostile_region():
	var builder := TestStateBuilder.new()
	builder.with_region("home", true, "red")
	builder.with_region("enemy", true, "blue")
	builder.with_adjacent("home", "enemy")
	builder.with_unit_type("infantry", "land", 1)
	builder.with_stack_unit("infantry", "home", "red")

	var state := builder.build_state()
	state.current_phase = "noncombat_move"
	state.current_faction_id = "red"
	var ruleset := builder.build_ruleset()
	var validator: MovementValidator = MovementValidator.new()

	var result := validator.validate_stack_move(
		"home", "enemy", "infantry", "red", 1, state, ruleset
	)
	assert_false(result.ok)
	assert_eq(result.errors[0].code, "MOVE_ILLEGAL_DESTINATION")


func test_combat_move_can_enter_hostile_region():
	var builder := TestStateBuilder.new()
	builder.with_region("home", true, "red")
	builder.with_region("enemy", true, "blue")
	builder.with_adjacent("home", "enemy")
	builder.with_unit_type("infantry", "land", 1)
	builder.with_stack_unit("infantry", "home", "red")

	var state := builder.build_state()
	state.current_phase = "combat_move"
	state.current_faction_id = "red"
	var ruleset := builder.build_ruleset()
	var validator: MovementValidator = MovementValidator.new()

	var result := validator.validate_stack_move(
		"home", "enemy", "infantry", "red", 1, state, ruleset
	)
	assert_true(result.ok, "Expected combat move into hostile region to be legal")


func test_cannot_move_units_that_arrived_this_phase():
	var builder := TestStateBuilder.new()
	builder.with_region("home", true, "red")
	builder.with_region("forward", true, "red")
	builder.with_adjacent("home", "forward")
	builder.with_unit_type("infantry", "land", 1)
	builder.with_stack_unit("infantry", "home", "red", 2)

	var state := builder.build_state()
	state.current_phase = "combat_move"
	state.current_faction_id = "red"
	var ruleset := builder.build_ruleset()
	var validator: MovementValidator = MovementValidator.new()

	var first := validator.validate_stack_move(
		"home", "forward", "infantry", "red", 1, state, ruleset
	)
	assert_true(first.ok)
	state.record_stack_arrival("red", "forward", "infantry", 1)
	state.region_units["home"] = [{"faction_id": "red", "unit_type_id": "infantry", "count": 1}]
	state.region_units["forward"] = [{"faction_id": "red", "unit_type_id": "infantry", "count": 1}]

	var second := validator.validate_stack_move(
		"forward", "home", "infantry", "red", 1, state, ruleset
	)
	assert_false(second.ok)
	assert_eq(second.errors[0].code, "MOVE_ALREADY_MOVED")

	var third := validator.validate_stack_move(
		"home", "forward", "infantry", "red", 1, state, ruleset
	)
	assert_true(third.ok, "Unmoved stack at source should still be movable")
