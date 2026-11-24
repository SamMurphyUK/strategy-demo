extends GutTest

func test_mobilize_forfeit_clears_pending() -> void:
	var session = GameSessionFactory.create(GameSessionFactory.Mode.STUB)
	var r1 = session.apply_command({
		"command_id": "test_cmd_002",
		"player_id": "allies",
		"type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "infantry", "count": 1}]},
	})
	assert_eq(r1.get("result_type"), "ok")
	for i in 5:
		session.apply_command({"command_id": "test_cmd_%03d" % (3 + i), "player_id": "allies", "type": "end_phase", "payload": {}})
	var snapshot = session.get_state()
	assert_eq(snapshot["pending_purchases"]["allies"], [])
