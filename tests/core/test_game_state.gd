extends GutTest

var state: GameState


func before_each() -> void:
	state = GameState.new()
	_setup_basic_state()


func _setup_basic_state() -> void:
	# Add regions
	var region_a := Region.from_dict({
		"id": "region_a", "name": "Region A", "type": "land",
		"ipc_value": 5, "owner_faction_id": "red",
		"is_capital": true, "has_factory": true
	})
	var region_b := Region.from_dict({
		"id": "region_b", "name": "Region B", "type": "land",
		"ipc_value": 3, "owner_faction_id": "blue",
		"is_capital": false, "has_factory": false
	})
	var sea_zone := Region.from_dict({
		"id": "sea_1", "name": "Sea Zone 1", "type": "sea",
		"ipc_value": 0, "owner_faction_id": "",
		"is_capital": false, "has_factory": false
	})
	
	state.regions["region_a"] = region_a
	state.regions["region_b"] = region_b
	state.regions["sea_1"] = sea_zone
	
	state.adjacency["region_a"] = ["region_b", "sea_1"]
	state.adjacency["region_b"] = ["region_a"]
	state.adjacency["sea_1"] = ["region_a"]
	
	state.region_units["region_a"] = []
	state.region_units["region_b"] = []
	state.region_units["sea_1"] = []
	
	state.ipc["red"] = 20
	state.ipc["blue"] = 15


func test_get_adjacent_regions() -> void:
	var adjacent := state.get_adjacent_regions("region_a")
	assert_eq(adjacent.size(), 2, "Region A should have 2 adjacent regions")
	assert_true("region_b" in adjacent, "Should include region_b")
	assert_true("sea_1" in adjacent, "Should include sea_1")


func test_get_adjacent_regions_empty() -> void:
	var adjacent := state.get_adjacent_regions("nonexistent")
	assert_eq(adjacent.size(), 0, "Nonexistent region should return empty array")


func test_is_adjacent() -> void:
	assert_true(state.is_adjacent("region_a", "region_b"), "A and B are adjacent")
	assert_true(state.is_adjacent("region_a", "sea_1"), "A and sea_1 are adjacent")
	assert_false(state.is_adjacent("region_b", "sea_1"), "B and sea_1 are not adjacent")


func test_get_region_owner() -> void:
	assert_eq(state.get_region_owner("region_a"), "red")
	assert_eq(state.get_region_owner("region_b"), "blue")
	assert_eq(state.get_region_owner("sea_1"), "")


func test_set_region_owner() -> void:
	state.set_region_owner("region_b", "red")
	assert_eq(state.get_region_owner("region_b"), "red")


func test_ipc_operations() -> void:
	assert_eq(state.get_faction_ipc("red"), 20)
	state.modify_ipc("red", 5)
	assert_eq(state.get_faction_ipc("red"), 25)
	state.modify_ipc("red", -10)
	assert_eq(state.get_faction_ipc("red"), 15)


func test_generate_instance_id_unique() -> void:
	var id1 := state.generate_instance_id("transport", "red")
	var id2 := state.generate_instance_id("transport", "red")
	var id3 := state.generate_instance_id("transport", "blue")
	
	assert_ne(id1, id2, "Same faction IDs should be unique")
	assert_true(id1.begins_with("transport_red_"), "ID format should be type_faction_seq")
	assert_true(id3.begins_with("transport_blue_"), "Different faction should have different prefix")


func test_get_faction_units_in_region() -> void:
	state.region_units["region_a"] = [
		{"faction_id": "red", "unit_type_id": "infantry", "count": 3},
		{"faction_id": "blue", "unit_type_id": "infantry", "count": 2}
	]
	
	var red_units := state.get_faction_units_in_region("region_a", "red")
	var blue_units := state.get_faction_units_in_region("region_a", "blue")
	
	assert_eq(red_units.size(), 1, "Red should have 1 unit stack")
	assert_eq(red_units[0].count, 3, "Red should have 3 infantry")
	assert_eq(blue_units.size(), 1, "Blue should have 1 unit stack")


func test_get_enemy_units_in_region() -> void:
	state.region_units["region_a"] = [
		{"faction_id": "red", "unit_type_id": "infantry", "count": 3},
		{"faction_id": "blue", "unit_type_id": "infantry", "count": 2}
	]
	
	var enemies := state.get_enemy_units_in_region("region_a", "red")
	assert_eq(enemies.size(), 1, "Should find 1 enemy stack")
	assert_eq(enemies[0].faction_id, "blue", "Enemy should be blue")


func test_to_snapshot() -> void:
	state.current_faction_id = "red"
	state.current_phase = "purchase"
	state.turn_number = 1
	state.game_round = 1
	
	var snapshot := state.to_snapshot()
	
	assert_eq(snapshot.turn_info.current_faction_id, "red")
	assert_eq(snapshot.turn_info.current_phase, "purchase")
	assert_eq(snapshot.game_round, 1)
	assert_true("ipc" in snapshot, "Snapshot should include IPC")
	assert_true("regions" in snapshot, "Snapshot should include regions")
