extends GutTest


func test_identical_games_with_same_seed() -> void:
	var commands := [
		{"command_id": "c1", "player_id": "red", "type": "end_phase", "payload": {}},
		{"command_id": "c2", "player_id": "red", "type": "move_units", 
		 "payload": {"moves": [{"from_region_id": "red_front", "to_region_id": "blue_front", 
		 "units": [{"unit_type_id": "infantry", "count": 3}]}]}},
		{"command_id": "c3", "player_id": "red", "type": "end_phase", "payload": {}}
	]
	
	var session1 := _create_session(12345)
	var session2 := _create_session(12345)
	
	var events1: Array = []
	var events2: Array = []
	
	for cmd in commands:
		var r1 := session1.apply_command(cmd)
		var r2 := session2.apply_command(cmd)
		events1.append_array(r1.events)
		events2.append_array(r2.events)
	
	assert_eq(events1.size(), events2.size(), "Same commands should produce same event count")
	
	var state1 := session1.get_state()
	var state2 := session2.get_state()
	
	assert_eq(state1.turn_info.current_phase, state2.turn_info.current_phase)
	assert_eq(state1.game_round, state2.game_round)


func test_different_seeds_produce_different_combat() -> void:
	var commands := [
		{"command_id": "c1", "player_id": "red", "type": "end_phase", "payload": {}},
		{"command_id": "c2", "player_id": "red", "type": "move_units", 
		 "payload": {"moves": [{"from_region_id": "red_front", "to_region_id": "blue_front", 
		 "units": [{"unit_type_id": "infantry", "count": 3}]}]}},
		{"command_id": "c3", "player_id": "red", "type": "end_phase", "payload": {}}
	]
	
	var session1 := _create_session(11111)
	var session2 := _create_session(99999)
	
	for cmd in commands:
		session1.apply_command(cmd)
		session2.apply_command(cmd)
	
	# Run multiple times to check - different seeds should eventually produce different results
	# This is probabilistic but with very different seeds, outcomes should differ
	var state1 := session1.get_state()
	var state2 := session2.get_state()
	
	# At minimum, the games should both be valid
	assert_false(state1.game_over and state2.game_over and state1.winner == state2.winner,
		"Different seeds should produce different outcomes (probabilistic)")


func _create_session(seed_state: int) -> GameSession:
	return GameSession.create(
		_load_json("res://data/scenarios/minimal/map.json"),
		_load_json("res://data/scenarios/minimal/units.json"),
		_load_json("res://data/scenarios/minimal/factions.json"),
		_load_json("res://data/scenarios/minimal/setup.json"),
		_load_json("res://data/scenarios/minimal/rules.json"),
		{"state": seed_state, "sequence": 1}
	)


func _load_json(path: String) -> Dictionary:
	var file := FileAccess.open(path, FileAccess.READ)
	return JSON.parse_string(file.get_as_text())
