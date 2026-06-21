extends GutTest

const TransportLoadValidator := preload("res://core/validation/transport_load_validator.gd")
const TestStateBuilder := preload("res://tests/validator/helpers/test_state_builder.gd")


func test_cannot_load_if_unit_already_moved():
	var builder := TestStateBuilder.new()
	builder.with_region("coast", true, "red")
	builder.with_region("sea_1", false, "")
	builder.with_adjacent("coast", "sea_1")
	builder.with_unit_type("infantry", "land", 1)
	builder.with_unit_type("transport", "sea", 2)
	builder.with_stack_unit("infantry", "coast", "red", 2)

	var state := builder.build_state()
	state.regions["coast"].has_factory = false
	state.current_phase = "combat_move"
	state.record_stack_embark("red", "coast", "infantry", 1)
	state.transport_instances["transport_red_001"] = {
		"instance_id": "transport_red_001",
		"unit_type_id": "transport",
		"region_id": "sea_1",
		"cargo": [],
	}
	state.region_units["sea_1"] = [{
		"faction_id": "red",
		"unit_type_id": "transport",
		"instance_id": "transport_red_001",
		"count": 1,
	}]

	var validator: TransportLoadValidator = TransportLoadValidator.new()
	assert_false(validator.can_load_units(
		"transport_red_001",
		"coast",
		[{"unit_type_id": "infantry", "count": 1}],
		"red",
		state
	))


func test_transport_cargo_capacity_rules():
	var builder := TestStateBuilder.new()
	builder.with_region("coast", true, "red")
	builder.with_region("sea_1", false, "")
	builder.with_adjacent("coast", "sea_1")
	builder.with_unit_type("infantry", "land", 1)
	builder.with_unit_type("artillery", "land", 1)
	builder.with_unit_type("transport", "sea", 2)
	builder.with_stack_unit("infantry", "coast", "red", 2)
	builder.with_stack_unit("artillery", "coast", "red", 1)

	var state := builder.build_state()
	state.current_phase = "combat_move"
	state.transport_instances["transport_red_001"] = {
		"instance_id": "transport_red_001",
		"unit_type_id": "transport",
		"region_id": "sea_1",
		"cargo": [
			{"unit_type_id": "infantry", "count": 1},
			{"unit_type_id": "artillery", "count": 1},
		],
	}
	state.region_units["sea_1"] = [{
		"faction_id": "red",
		"unit_type_id": "transport",
		"instance_id": "transport_red_001",
		"count": 1,
	}]

	var validator: TransportLoadValidator = TransportLoadValidator.new()
	assert_false(validator.can_load_units(
		"transport_red_001", "coast", [{"unit_type_id": "infantry", "count": 1}], "red", state
	))
