extends GutTest

const TestStateBuilder := preload("res://tests/validator/helpers/test_state_builder.gd")


func test_cargo_summary_empty_transport() -> void:
	var state := TestStateBuilder.new() \
		.with_unit_type("transport", "sea", 2) \
		.build_state()
	state.transport_instances["transport_allies_001"] = {
		"instance_id": "transport_allies_001",
		"unit_type_id": "transport",
		"cargo": [],
		"region_id": "sea_1",
	}
	var lines := RegionUnitDisplay.cargo_summary_lines(state, "transport_allies_001")
	assert_eq(lines.size(), 1)
	assert_eq(str(lines[0]), "Empty")


func test_cargo_summary_lists_loaded_units() -> void:
	var state := TestStateBuilder.new() \
		.with_unit_type("transport", "sea", 2) \
		.build_state()
	state.transport_instances["transport_allies_001"] = {
		"instance_id": "transport_allies_001",
		"unit_type_id": "transport",
		"cargo": [
			{"unit_type_id": "infantry", "count": 2},
			{"unit_type_id": "tank", "count": 1},
		],
		"region_id": "sea_1",
	}
	var lines := RegionUnitDisplay.cargo_summary_lines(state, "transport_allies_001")
	assert_eq(lines.size(), 2)
	assert_true("Infantry × 2" in lines)
	assert_true("Tank × 1" in lines)


func test_is_container_unit_detects_transport() -> void:
	var state := TestStateBuilder.new() \
		.with_unit_type("transport", "sea", 2) \
		.with_unit_type("infantry", "land", 1) \
		.build_state()
	state.unit_types["transport"].container = {"capacity": 2}
	assert_true(RegionUnitDisplay.is_container_unit(state, "transport"))
	assert_false(RegionUnitDisplay.is_container_unit(state, "infantry"))
