extends GutTest

func test_purchase_insufficient_ipc() -> void:
	var session = GameSessionFactory.create(GameSessionFactory.Mode.STUB)
	session.state.ipc["allies"] = 3
	var result = session.apply_command({
		"command_id": "test_cmd_001",
		"player_id": "allies",
		"type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "infantry", "count": 2}]},
	})
	assert_eq(result.get("result_type"), "error")
	assert_eq(result.get("error", {}).get("code", ""), "PURCHASE_FAILED")
