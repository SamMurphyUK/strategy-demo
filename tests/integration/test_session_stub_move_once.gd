extends GutTest

var session: GameSessionStub


func before_each() -> void:
	session = GameSessionStub.new()
	session.initialize_demo(12345)
	session.apply_command({
		"command_id": "to_combat",
		"player_id": "allies",
		"type": "end_phase",
		"payload": {},
	})


func test_second_move_from_destination_rejected() -> void:
	var pair := _find_allies_infantry_move_pair(session)
	assert_false(pair.is_empty(), "Need adjacent allied region with infantry for move-once test")

	var from_region: String = pair["from"]
	var to_region: String = pair["to"]

	var first := session.apply_command({
		"command_id": "move_1",
		"player_id": "allies",
		"type": "move_units",
		"payload": {
			"moves": [{
				"from_region_id": from_region,
				"to_region_id": to_region,
				"units": [{"unit_type_id": "infantry", "count": 1}],
			}],
		},
	})
	assert_eq(str(first.result_type), "ok")

	var second := session.apply_command({
		"command_id": "move_2",
		"player_id": "allies",
		"type": "move_units",
		"payload": {
			"moves": [{
				"from_region_id": to_region,
				"to_region_id": from_region,
				"units": [{"unit_type_id": "infantry", "count": 1}],
			}],
		},
	})
	assert_eq(str(second.result_type), "error")
	assert_eq(str(second.error.code), "MOVE_ALREADY_MOVED")


func _find_allies_infantry_move_pair(s: GameSessionStub) -> Dictionary:
	var validator := MovementValidator.new()
	for region_id in s.state.region_units.keys():
		if s.state.movable_stack_count("allies", region_id, "infantry") <= 0:
			continue
		var legal: Array = validator.get_legal_destinations_for_stack(
			region_id, "infantry", "allies", s.state, s.ruleset
		)
		if legal.is_empty():
			continue
		return {"from": region_id, "to": str(legal[0])}
	return {}
