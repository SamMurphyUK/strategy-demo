extends GutTest

const MovementValidator := preload("res://core/validation/movement_validator.gd")
const TestStateBuilder := preload("res://tests/validator/helpers/test_state_builder.gd")

func test_sea_unit_cannot_mobilize_at_factory_land():
	var builder := TestStateBuilder.new()
	builder.with_region("factory", true, "red")
	builder.with_region("sea_1", false, "")
	builder.with_adjacent("factory", "sea_1")
	builder.with_unit_type("transport", "sea", 2)

	var state := builder.build_state()
	state.regions["factory"].has_factory = true
	var ruleset := builder.build_ruleset()

	assert_false(ruleset.can_mobilize_unit_at("transport", "factory", "red", state))
	assert_true(ruleset.can_mobilize_unit_at("transport", "sea_1", "red", state))


func test_land_unit_still_mobilizes_at_owned_factory():
	var builder := TestStateBuilder.new()
	builder.with_region("factory", true, "red")
	builder.with_region("sea_1", false, "")
	builder.with_adjacent("factory", "sea_1")
	builder.with_unit_type("infantry", "land", 1)

	var state := builder.build_state()
	state.regions["factory"].has_factory = true
	var ruleset := builder.build_ruleset()

	assert_true(ruleset.can_mobilize_unit_at("infantry", "factory", "red", state))
	assert_false(ruleset.can_mobilize_unit_at("infantry", "sea_1", "red", state))


func test_sea_movement_cannot_path_through_land():
	var builder := TestStateBuilder.new()
	builder.with_region("sea_a", false, "")
	builder.with_region("land_bridge", true, "red")
	builder.with_region("sea_b", false, "")
	builder.with_adjacent("sea_a", "land_bridge")
	builder.with_adjacent("land_bridge", "sea_b")
	builder.with_unit_type("battleship", "sea", 2)
	builder.with_stack_unit("battleship", "sea_a", "red")

	var state := builder.build_state()
	state.current_phase = "combat_move"
	var ruleset := builder.build_ruleset()
	var validator: MovementValidator = MovementValidator.new()

	var legal := validator.get_legal_destinations_for_stack(
		"sea_a", "battleship", "red", state, ruleset
	)
	assert_false("land_bridge" in legal)
	assert_false("sea_b" in legal, "Sea units cannot reach sea_b through land_bridge")


func test_sea_movement_range_two_sea_zones():
	var builder := TestStateBuilder.new()
	builder.with_region("sea_a", false, "")
	builder.with_region("sea_b", false, "")
	builder.with_region("sea_c", false, "")
	builder.with_adjacent("sea_a", "sea_b")
	builder.with_adjacent("sea_b", "sea_c")
	builder.with_unit_type("battleship", "sea", 2)
	builder.with_stack_unit("battleship", "sea_a", "red")

	var state := builder.build_state()
	state.current_phase = "combat_move"
	var ruleset := builder.build_ruleset()
	var validator: MovementValidator = MovementValidator.new()

	var legal := validator.get_legal_destinations_for_stack(
		"sea_a", "battleship", "red", state, ruleset
	)
	assert_true("sea_b" in legal)
	assert_true("sea_c" in legal)
