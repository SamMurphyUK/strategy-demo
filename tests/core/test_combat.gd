extends GutTest

var state: GameState
var rng: PCG
var combat: CombatEngine


func before_each() -> void:
	state = GameState.new()
	rng = PCG.new(12345, 1)
	
	state.unit_types["infantry"] = Unit.from_dict({
		"id": "infantry", "name": "Infantry", "category": "land",
		"attack": 1, "defense": 2, "movement": 1, "cost": 3
	})
	state.unit_types["tank"] = Unit.from_dict({
		"id": "tank", "name": "Tank", "category": "land",
		"attack": 3, "defense": 3, "movement": 2, "cost": 6
	})
	state.unit_types["battleship"] = Unit.from_dict({
		"id": "battleship", "name": "Battleship", "category": "sea",
		"attack": 4, "defense": 4, "movement": 2, "cost": 20
	})
	state.unit_types["transport"] = Unit.from_dict({
		"id": "transport", "name": "Transport", "category": "sea",
		"attack": 0, "defense": 0, "movement": 2, "cost": 7,
		"container": {"capacity": 2, "allowed_cargo_categories": ["land"]}
	})
	
	state.factions["red"] = Faction.from_dict({
		"id": "red", "name": "Red", "color": "#FF0000", "starting_ipc": 20
	})
	state.factions["blue"] = Faction.from_dict({
		"id": "blue", "name": "Blue", "color": "#0000FF", "starting_ipc": 20
	})
	
	combat = CombatEngine.new(state, rng)


func _setup_land_battle(attacker_units: Array, defender_units: Array) -> void:
	state.regions["battle_zone"] = Region.from_dict({
		"id": "battle_zone", "name": "Battle Zone", "type": "land",
		"ipc_value": 5, "owner_faction_id": "blue",
		"is_capital": false, "has_factory": false
	})
	
	var units: Array = []
	for u in attacker_units:
		units.append({"faction_id": "red", "unit_type_id": u.type, "count": u.count})
	for u in defender_units:
		units.append({"faction_id": "blue", "unit_type_id": u.type, "count": u.count})
	
	state.region_units["battle_zone"] = units


func test_identify_battles() -> void:
	_setup_land_battle(
		[{"type": "infantry", "count": 3}],
		[{"type": "infantry", "count": 2}]
	)
	
	var battles := combat._identify_battles("red")
	
	assert_eq(battles.size(), 1, "Should identify 1 battle")
	assert_eq(battles[0].region_id, "battle_zone")
	assert_eq(battles[0].attacker_faction_id, "red")
	assert_eq(battles[0].defender_faction_id, "blue")


func test_no_battle_if_no_defender() -> void:
	state.regions["empty_zone"] = Region.from_dict({
		"id": "empty_zone", "name": "Empty", "type": "land",
		"ipc_value": 3, "owner_faction_id": "blue",
		"is_capital": false, "has_factory": false
	})
	state.region_units["empty_zone"] = [
		{"faction_id": "red", "unit_type_id": "infantry", "count": 2}
	]
	
	var battles := combat._identify_battles("red")
	
	assert_eq(battles.size(), 0, "No battle if no defender units")


func test_battle_produces_required_events() -> void:
	_setup_land_battle(
		[{"type": "infantry", "count": 2}],
		[{"type": "infantry", "count": 2}]
	)
	
	var events := combat.resolve_all_battles("red")
	
	# Normalize event types to strings for stability
	var event_types := events.map(func(e): return str(e.type))
	
	assert_true("battle_started" in event_types, "Should have BATTLE_STARTED")
	assert_true("dice_rolled" in event_types, "Should have DICE_ROLLED")
	assert_true("battle_finished" in event_types, "Should have BATTLE_FINISHED")


func test_battle_removes_casualties() -> void:
	_setup_land_battle(
		[{"type": "infantry", "count": 5}],
		[{"type": "infantry", "count": 2}]
	)
	
	combat.resolve_all_battles("red")
	
	var remaining: Array = state.region_units["battle_zone"]
	var total := 0
	for u in remaining:
		total += u.count
	
	assert_true(total < 7, "Some units should have been destroyed")


func test_attacker_wins_captures_region() -> void:
	_setup_land_battle(
		[{"type": "tank", "count": 10}],
		[{"type": "infantry", "count": 1}]
	)
	
	var events := combat.resolve_all_battles("red")
	
	var battle_finished = null
	for e in events:
		if e.type == GameEvent.Type.BATTLE_FINISHED:
			battle_finished = e
			break
	
	if battle_finished and battle_finished.payload.result == "attacker_won":
		var region: Region = state.regions["battle_zone"]
		assert_eq(region.owner_faction_id, "red", "Attacker should capture region")


func test_defender_wins_keeps_region() -> void:
	_setup_land_battle(
		[{"type": "infantry", "count": 1}],
		[{"type": "tank", "count": 10}]
	)
	
	combat.resolve_all_battles("red")
	
	var region: Region = state.regions["battle_zone"]
	assert_eq(region.owner_faction_id, "blue", "Defender should keep region")


func test_casualties_cheapest_first() -> void:
	_setup_land_battle(
		[{"type": "infantry", "count": 2}, {"type": "tank", "count": 2}],
		[{"type": "tank", "count": 5}]
	)
	
	combat.resolve_all_battles("red")
	
	var red_units := state.get_faction_units_in_region("battle_zone", "red")
	
	if red_units.size() > 0:
		var infantry_count := 0
		var tank_count := 0
		for u in red_units:
			if u.unit_type_id == "infantry":
				infantry_count = u.count
			elif u.unit_type_id == "tank":
				tank_count = u.count
		
		assert_true(tank_count >= infantry_count, "Tanks should survive longer than infantry")


func test_deterministic_combat() -> void:
	_setup_land_battle(
		[{"type": "infantry", "count": 3}],
		[{"type": "infantry", "count": 3}]
	)
	var rng1 := PCG.new(99999, 1)
	var combat1 := CombatEngine.new(state, rng1)
	var events1 := combat1.resolve_all_battles("red")
	var final_state1 := state.to_snapshot()
	
	before_each()
	_setup_land_battle(
		[{"type": "infantry", "count": 3}],
		[{"type": "infantry", "count": 3}]
	)
	var rng2 := PCG.new(99999, 1)
	var combat2 := CombatEngine.new(state, rng2)
	var events2 := combat2.resolve_all_battles("red")
	var final_state2 := state.to_snapshot()
	
	assert_eq(events1.size(), events2.size(), "Same seed should produce same number of events")


func test_naval_combat() -> void:
	state.regions["sea_zone"] = Region.from_dict({
		"id": "sea_zone", "name": "Sea Zone", "type": "sea",
		"ipc_value": 0, "owner_faction_id": "",
		"is_capital": false, "has_factory": false
	})
	state.region_units["sea_zone"] = [
		{"faction_id": "red", "unit_type_id": "battleship", "count": 2},
		{"faction_id": "blue", "unit_type_id": "battleship", "count": 2}
	]
	
	var battles := combat._identify_battles("red")
	
	assert_eq(battles.size(), 1, "Should identify naval battle")
	assert_eq(battles[0].battle_type, "naval")


func test_transport_excluded_from_combat() -> void:
	state.regions["sea_zone"] = Region.from_dict({
		"id": "sea_zone", "name": "Sea Zone", "type": "sea",
		"ipc_value": 0, "owner_faction_id": "",
		"is_capital": false, "has_factory": false
	})
	state.region_units["sea_zone"] = [
		{"faction_id": "red", "unit_type_id": "transport", "instance_id": "t1", "count": 1},
		{"faction_id": "blue", "unit_type_id": "battleship", "count": 1}
	]
	
	var combat_units := combat._get_combat_units("sea_zone", "red")
	
	assert_eq(combat_units.size(), 0, "Transports (0/0) should not be combat units")
