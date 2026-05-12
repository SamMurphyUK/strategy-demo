extends GutTest

var state: GameState
var placement: PlacementEngine


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
	
	state.factions["red"] = Faction.from_dict({
		"id": "red", "name": "Red", "color": "#FF0000", "starting_ipc": 20
	})
	
	state.regions["factory_region"] = Region.from_dict({
		"id": "factory_region", "name": "Factory", "type": "land",
		"ipc_value": 8, "owner_faction_id": "red",
		"is_capital": true, "has_factory": true
	})
	state.regions["sea_zone"] = Region.from_dict({
		"id": "sea_zone", "name": "Sea Zone", "type": "sea",
		"ipc_value": 0, "owner_faction_id": "",
		"is_capital": false, "has_factory": false
	})
	
	state.adjacency["factory_region"] = ["sea_zone"]
	state.adjacency["sea_zone"] = ["factory_region"]
	
	state.region_units["factory_region"] = []
	state.region_units["sea_zone"] = []
	
	state.pending_purchases["red"] = [{"unit_type_id": "infantry", "count": 3}]
	state.factories_controlled_at_turn_start["red"] = ["factory_region"]
	
	placement = PlacementEngine.new(state)


func test_placement_adds_units_to_region() -> void:
	var cmd := Command.from_dict({
		"command_id": "c1", "player_id": "red", "type": "place_units",
		"payload": {"placements": [{
			"region_id": "factory_region",
			"units": [{"unit_type_id": "infantry", "count": 3}]
		}]}
	})
	
	placement.process_placement(cmd)
	
	var units := state.get_faction_units_in_region("factory_region", "red")
	assert_eq(units.size(), 1, "Should have 1 unit stack")
	assert_eq(units[0].unit_type_id, "infantry")
	assert_eq(units[0].count, 3)


func test_placement_clears_pending_purchases() -> void:
	var cmd := Command.from_dict({
		"command_id": "c1", "player_id": "red", "type": "place_units",
		"payload": {"placements": [{
			"region_id": "factory_region",
			"units": [{"unit_type_id": "infantry", "count": 3}]
		}]}
	})
	
	placement.process_placement(cmd)
	
	assert_eq(state.pending_purchases["red"].size(), 0, "Pending should be cleared")


func test_placement_emits_event() -> void:
	var cmd := Command.from_dict({
		"command_id": "c1", "player_id": "red", "type": "place_units",
		"payload": {"placements": [{
			"region_id": "factory_region",
			"units": [{"unit_type_id": "infantry", "count": 2}]
		}]}
	})
	
	var events := placement.process_placement(cmd)
	
	assert_eq(events.size(), 1)
	assert_eq(events[0].type, GameEvent.Type.UNITS_PLACED)


func test_placement_creates_transport_instances() -> void:
	state.pending_purchases["red"] = [{"unit_type_id": "transport", "count": 2}]
	
	var cmd := Command.from_dict({
		"command_id": "c1", "player_id": "red", "type": "place_units",
		"payload": {"placements": [{
			"region_id": "sea_zone",
			"units": [{"unit_type_id": "transport", "count": 2}]
		}]}
	})
	
	placement.process_placement(cmd)
	
	var instance_count := 0
	for key in state.transport_instances:
		if key.begins_with("transport_red_"):
			instance_count += 1
	
	assert_eq(instance_count, 2, "Should create 2 transport instances")


func test_check_forfeited_when_factory_lost() -> void:
	state.regions["factory_region"].owner_faction_id = "blue"
	state.pending_purchases["red"] = [{"unit_type_id": "infantry", "count": 3}]
	
	var events := placement.check_forfeited("red")
	
	assert_eq(events.size(), 1, "Should emit forfeiture event")
	assert_eq(events[0].type, GameEvent.Type.PLACEMENT_FORFEITED)
	assert_eq(events[0].payload.ipc_lost, 9)


func test_no_forfeiture_when_factory_retained() -> void:
	var events := placement.check_forfeited("red")
	
	assert_eq(events.size(), 0, "No forfeiture if factory retained")
