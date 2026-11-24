extends GutTest

var state: GameState
var movement: MovementEngine


func before_each() -> void:
	state = GameState.new()
	
	state.unit_types["infantry"] = Unit.from_dict({
		"id": "infantry", "name": "Infantry", "category": "land",
		"attack": 1, "defense": 2, "movement": 1, "cost": 3
	})
	state.unit_types["transport"] = Unit.from_dict({
		"id": "transport", "name": "Transport", "category": "sea",
		"attack": 0, "defense": 0, "movement": 2, "cost": 7,
		"container": {"capacity": 2, "allowed_cargo_categories": ["land"]}
	})
	
	state.regions["land_a"] = Region.from_dict({
		"id": "land_a", "name": "Land A", "type": "land",
		"ipc_value": 3, "owner_faction_id": "red",
		"is_capital": false, "has_factory": false
	})
	state.regions["land_b"] = Region.from_dict({
		"id": "land_b", "name": "Land B", "type": "land",
		"ipc_value": 3, "owner_faction_id": "red",
		"is_capital": false, "has_factory": false
	})
	state.regions["sea_1"] = Region.from_dict({
		"id": "sea_1", "name": "Sea 1", "type": "sea",
		"ipc_value": 0, "owner_faction_id": "",
		"is_capital": false, "has_factory": false
	})
	
	state.adjacency["land_a"] = ["land_b", "sea_1"]
	state.adjacency["land_b"] = ["land_a"]
	state.adjacency["sea_1"] = ["land_a"]
	
	state.region_units["land_a"] = [{"faction_id": "red", "unit_type_id": "infantry", "count": 5}]
	state.region_units["land_b"] = []
	state.region_units["sea_1"] = []
	
	var transport_id := "transport_red_001"
	state.transport_instances[transport_id] = {
		"instance_id": transport_id,
		"unit_type_id": "transport",
		"cargo": [],
		"region_id": "sea_1"
	}
	state.region_units["sea_1"] = [{
		"faction_id": "red",
		"unit_type_id": "transport",
		"instance_id": transport_id,
		"count": 1
	}]
	
	movement = MovementEngine.new(state)


func test_move_units_transfers_between_regions() -> void:
	var cmd := Command.from_dict({
		"command_id": "c1", "player_id": "red", "type": "move_units",
		"payload": {"moves": [{
			"from_region_id": "land_a",
			"to_region_id": "land_b",
			"units": [{"unit_type_id": "infantry", "count": 3}]
		}]}
	})
	
	movement.process_move(cmd)
	
	var land_a_units := state.get_faction_units_in_region("land_a", "red")
	var land_b_units := state.get_faction_units_in_region("land_b", "red")
	
	assert_eq(land_a_units[0].count, 2, "Land A should have 2 infantry left")
	assert_eq(land_b_units[0].count, 3, "Land B should have 3 infantry")


func test_move_units_emits_event() -> void:
	var cmd := Command.from_dict({
		"command_id": "c1", "player_id": "red", "type": "move_units",
		"payload": {"moves": [{
			"from_region_id": "land_a",
			"to_region_id": "land_b",
			"units": [{"unit_type_id": "infantry", "count": 2}]
		}]}
	})
	
	var events := movement.process_move(cmd)
	
	assert_eq(events.size(), 1)
	assert_eq(events[0].type, GameEvent.Type.UNITS_MOVED)
	assert_eq(events[0].payload.faction_id, "red")


func test_arrived_units_cannot_move_again_this_phase() -> void:
	state.current_phase = "combat_move"
	var cmd := Command.from_dict({
		"command_id": "c1", "player_id": "red", "type": "move_units",
		"payload": {"moves": [{
			"from_region_id": "land_a",
			"to_region_id": "land_b",
			"units": [{"unit_type_id": "infantry", "count": 1}]
		}]}
	})
	movement.process_move(cmd)
	assert_eq(state.movable_stack_count("red", "land_b", "infantry"), 0)
	assert_eq(state.movable_stack_count("red", "land_a", "infantry"), 4)


func test_move_all_units_removes_stack() -> void:
	var cmd := Command.from_dict({
		"command_id": "c1", "player_id": "red", "type": "move_units",
		"payload": {"moves": [{
			"from_region_id": "land_a",
			"to_region_id": "land_b",
			"units": [{"unit_type_id": "infantry", "count": 5}]
		}]}
	})
	
	movement.process_move(cmd)
	
	var land_a_units := state.get_faction_units_in_region("land_a", "red")
	assert_eq(land_a_units.size(), 0, "Land A should have no red units")


func test_load_transport() -> void:
	var cmd := Command.from_dict({
		"command_id": "c1", "player_id": "red", "type": "load_transport",
		"payload": {
			"transport_instance_id": "transport_red_001",
			"from_region_id": "land_a",
			"units": [{"unit_type_id": "infantry", "count": 2}]
		}
	})
	
	movement.process_load(cmd)
	
	var land_a_units := state.get_faction_units_in_region("land_a", "red")
	assert_eq(land_a_units[0].count, 3, "Land A should have 3 infantry left")
	
	var transport: Dictionary = state.transport_instances["transport_red_001"]
	assert_eq(transport.cargo.size(), 1, "Transport should have cargo")
	assert_eq(transport.cargo[0].unit_type_id, "infantry")
	assert_eq(transport.cargo[0].count, 2)


func test_load_transport_emits_event() -> void:
	var cmd := Command.from_dict({
		"command_id": "c1", "player_id": "red", "type": "load_transport",
		"payload": {
			"transport_instance_id": "transport_red_001",
			"from_region_id": "land_a",
			"units": [{"unit_type_id": "infantry", "count": 1}]
		}
	})
	
	var events := movement.process_load(cmd)
	
	assert_eq(events.size(), 1)
	assert_eq(events[0].type, GameEvent.Type.TRANSPORT_LOADED)
	assert_eq(events[0].payload.transport_instance_id, "transport_red_001")


func test_unload_transport() -> void:
	state.transport_instances["transport_red_001"].cargo = [
		{"unit_type_id": "infantry", "count": 2}
	]
	
	var cmd := Command.from_dict({
		"command_id": "c1", "player_id": "red", "type": "unload_transport",
		"payload": {
			"transport_instance_id": "transport_red_001",
			"to_region_id": "land_a",
			"units": [{"unit_type_id": "infantry", "count": 2}]
		}
	})
	
	movement.process_unload(cmd)
	
	var transport: Dictionary = state.transport_instances["transport_red_001"]
	assert_eq(transport.cargo.size(), 0, "Transport should be empty")
	
	var land_a_units := state.get_faction_units_in_region("land_a", "red")
	assert_eq(land_a_units[0].count, 7, "Land A should have 7 infantry")


func test_unload_transport_emits_event() -> void:
	state.transport_instances["transport_red_001"].cargo = [
		{"unit_type_id": "infantry", "count": 1}
	]
	
	var cmd := Command.from_dict({
		"command_id": "c1", "player_id": "red", "type": "unload_transport",
		"payload": {
			"transport_instance_id": "transport_red_001",
			"to_region_id": "land_a",
			"units": [{"unit_type_id": "infantry", "count": 1}]
		}
	})
	
	var events := movement.process_unload(cmd)
	
	assert_eq(events.size(), 1)
	assert_eq(events[0].type, GameEvent.Type.TRANSPORT_UNLOADED)
