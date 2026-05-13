extends GutTest

const SolverScript := preload("res://core/validation/plane_landing_dependency_solver.gd")
const VT := preload("res://core/validation/validation_types.gd")
const TestStateBuilder := preload("res://tests/validator/helpers/test_state_builder.gd")

func test_fighter_finds_friendly_land():
	var builder := TestStateBuilder.new()
	builder.with_region("Sea", false).with_region("Land", true, "red")
	builder.with_adjacent("Sea", "Land")
	builder.with_unit(1, "fighter", "Sea")

	var state := builder.build_state()
	var ruleset := builder.build_ruleset()
	ruleset.unit_move_ranges = { "fighter": 1 }

	var batch := VT.CombatMovementBatch.new()
	var move := VT.CombatMove.new()
	move.unit_id = 1
	move.from_region = "Sea"
	move.to_region = "Sea"
	batch.moves.append(move)

	var solver := SolverScript.new()
	var deps: Dictionary = solver.call(
		"compute_plane_dependencies",
		batch,
		state,
		ruleset
	)

	assert_true("Land" in deps["1"].possible_landing_regions)
