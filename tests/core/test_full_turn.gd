extends GutTest

var session: GameSession


func before_each() -> void:
	session = _create_session()


func _create_session() -> GameSession:
	return GameSession.create(
		_load_json("res://data/scenarios/minimal/map.json"),
		_load_json("res://data/scenarios/minimal/units.json"),
		_load_json("res://data/scenarios/minimal/factions.json"),
		_load_json("res://data/scenarios/minimal/setup.json"),
		_load_json("res://data/scenarios/minimal/rules.json"),
		{"state": 12345, "sequence": 1}
	)


func test_initial_state() -> void:
	var state := session.get_state()

	assert_eq(state.turn_info.current_faction_id, "red")
	assert_eq(str(state.turn_info.current_phase), "purchase")
	assert_eq(state.turn_info.turn_number, 1)
	assert_eq(state.game_round, 1)
	assert_eq(state.ipc.red, 24)
	assert_eq(state.ipc.blue, 24)


func test_complete_peaceful_turn() -> void:
	# Purchase phase - buy some infantry
	var result := session.apply_command({
		"command_id": "c1", "player_id": "red", "type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "infantry", "count": 2}]}
	})
	assert_eq(str(result.result_type), "ok")
	assert_eq(result.new_state.ipc.red, 18)

	# End purchase
	result = session.apply_command({
		"command_id": "c2", "player_id": "red", "type": "end_phase", "payload": {}
	})
	assert_eq(str(result.new_state.turn_info.current_phase), "combat_move")

	# End combat move (no moves)
	result = session.apply_command({
		"command_id": "c3", "player_id": "red", "type": "end_phase", "payload": {}
	})
	assert_eq(str(result.new_state.turn_info.current_phase), "noncombat_move")

	# End noncombat move
	result = session.apply_command({
		"command_id": "c4", "player_id": "red", "type": "end_phase", "payload": {}
	})
	assert_eq(str(result.new_state.turn_info.current_phase), "mobilize")

	# Place units
	result = session.apply_command({
		"command_id": "c5", "player_id": "red", "type": "place_units",
		"payload": {"placements": [{
			"region_id": "red_capital",
			"units": [{"unit_type_id": "infantry", "count": 2}]
		}]}
	})
	assert_eq(str(result.result_type), "ok")

	# End mobilize
	result = session.apply_command({
		"command_id": "c6", "player_id": "red", "type": "end_phase", "payload": {}
	})
	assert_eq(str(result.new_state.turn_info.current_phase), "collect_income")

	# End turn
	result = session.apply_command({
		"command_id": "c7", "player_id": "red", "type": "end_turn", "payload": {}
	})

	# ⭐ DEBUG: PRINT EVENT LOG
	print("\n=== EVENT LOG (peaceful turn) ===")
	for e in result.events:
		print(e)
	print("=== EVENT COUNT: %s ===" % result.events.size())
	# ⭐ END DEBUG

	assert_eq(result.new_state.turn_info.current_faction_id, "blue")
	assert_eq(str(result.new_state.turn_info.current_phase), "purchase")
	assert_eq(result.new_state.ipc.red, 30)


func test_movement_into_combat() -> void:
	# Skip purchase
	session.apply_command({
		"command_id": "c1",
		"player_id": "red",
		"type": "end_phase",
		"payload": {}
	})

	# Move infantry from red_front to blue_front
	var result := session.apply_command({
		"command_id": "c2",
		"player_id": "red",
		"type": "move_units",
		"payload": {
			"moves": [{
				"from_region_id": "red_front",
				"to_region_id": "blue_front",
				"units": [{"unit_type_id": "infantry", "count": 3}]
			}]
		}
	})
	assert_eq(str(result.result_type), "ok")

	# End combat move - this triggers battle
	result = session.apply_command({
		"command_id": "c3",
		"player_id": "red",
		"type": "end_phase",
		"payload": {}
	})

	# Should have battle events
	var has_battle := false
	for e in result.events:
		if str(e.get("type", "")) == "battle_started":
			has_battle = true
			break

	assert_true(has_battle, "Should have battle event")


func test_out_of_turn_rejected() -> void:
	var result := session.apply_command({
		"command_id": "c1", "player_id": "blue", "type": "purchase_units",
		"payload": {"purchases": []}
	})

	assert_eq(str(result.result_type), "error")
	assert_eq(str(result.error.code), "OUT_OF_TURN")


func test_wrong_phase_command_rejected() -> void:
	# In purchase phase, try to move units
	var result := session.apply_command({
		"command_id": "c1", "player_id": "red", "type": "move_units",
		"payload": {"moves": []}
	})

	assert_eq(str(result.result_type), "error")
	assert_eq(str(result.error.code), "ILLEGAL_ACTION")


func _load_json(path: String) -> Dictionary:
	var file := FileAccess.open(path, FileAccess.READ)
	return JSON.parse_string(file.get_as_text())
