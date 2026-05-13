extends GutTest

const CheckerScript := preload("res://core/validation/carrier_constraint_checker.gd")
const VT := preload("res://core/validation/validation_types.gd")
const TestStateBuilder := preload("res://tests/validator/helpers/test_state_builder.gd")

func test_plane_stranded_without_carrier():
	var builder := TestStateBuilder.new()
	builder.with_region("Sea1", false).with_region("Sea2", false)
	builder.with_adjacent("Sea1", "Sea2")
	builder.with_unit(1, "fighter", "Sea1")
	builder.with_unit(2, "carrier", "Sea2")

	var state := builder.build_state()
	var ruleset := builder.build_ruleset()

	var batch := VT.NonCombatMovementBatch.new()
	var move := VT.NonCombatMove.new()
	move.unit_id = 2
	move.from_region = "Sea2"
	move.to_region = "Sea2"
	batch.moves.append(move)

	var deps: Dictionary = {
		"1": VT.PlaneLandingDependency.new()
	}
	deps["1"].possible_landing_regions = []

	var checker := CheckerScript.new()
	var result: VT.ValidationResult = checker.call(
		"validate_carrier_moves_with_plane_dependencies",
		batch,
		state,
		deps
	)

	assert_false(result.ok)
	assert_eq(result.errors.size(), 1)
