extends GutTest

const TestStateBuilder := preload("res://tests/validator/helpers/test_state_builder.gd")


func _minimal_state() -> GameState:
	return TestStateBuilder.new() \
		.with_region("west_russia", true, "allies") \
		.with_region("ukraine", true, "axis") \
		.with_adjacent("west_russia", "ukraine") \
		.build_state()


func test_build_display_entries_splits_factions() -> void:
	var units := [
		{"unit_type_id": "infantry", "faction_id": "allies", "count": 2},
		{"unit_type_id": "infantry", "faction_id": "axis", "count": 3},
	]
	var entries := RegionUnitDisplay.build_display_entries(units)
	assert_eq(entries.size(), 2)
	var allies_count := 0
	var axis_count := 0
	for entry in entries:
		if entry.faction_id == "allies":
			allies_count = int(entry.count)
		if entry.faction_id == "axis":
			axis_count = int(entry.count)
	assert_eq(allies_count, 2)
	assert_eq(axis_count, 3)


func test_owned_region_reads_live_state_after_units_leave() -> void:
	var state := _minimal_state()
	state.current_phase = "combat_move"
	state.current_faction_id = "allies"
	state.set_region_owner("west_russia", "allies")
	state.region_units["west_russia"] = [
		{"unit_type_id": "infantry", "faction_id": "allies", "count": 3},
	]
	var before := RegionUnitDisplay.entries_for_region_inspector(state, "west_russia", "allies")
	assert_eq(int(before[0].count), 3)
	state.region_units["west_russia"] = [
		{"unit_type_id": "infantry", "faction_id": "allies", "count": 1},
	]
	var after := RegionUnitDisplay.entries_for_region_inspector(state, "west_russia", "allies")
	assert_eq(int(after[0].count), 1)


func test_combat_pool_detects_attackers_in_hostile_region() -> void:
	var state := _minimal_state()
	state.current_phase = "combat_move"
	state.current_faction_id = "allies"
	state.set_region_owner("ukraine", "axis")
	state.region_units["ukraine"] = [
		{"unit_type_id": "infantry", "faction_id": "axis", "count": 2},
		{"unit_type_id": "infantry", "faction_id": "allies", "count": 4},
	]
	assert_eq(RegionUnitDisplay.combat_pool_unit_count(state, "ukraine", "allies"), 4)
	assert_true("ukraine" in RegionUnitDisplay.regions_with_combat_pools(state, "allies"))


func test_hostile_region_shows_owner_units_not_merged_friendly() -> void:
	var state := _minimal_state()
	state.set_region_owner("ukraine", "axis")
	state.region_units["ukraine"] = [
		{"unit_type_id": "infantry", "faction_id": "axis", "count": 2},
		{"unit_type_id": "infantry", "faction_id": "allies", "count": 4},
	]
	var entries := RegionUnitDisplay.entries_for_region_inspector(state, "ukraine", "allies")
	assert_eq(entries.size(), 1)
	assert_eq(str(entries[0].faction_id), "axis")
	assert_eq(int(entries[0].count), 2)
