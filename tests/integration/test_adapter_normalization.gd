extends GutTest

func test_adapter_normalization_shape() -> void:
	var session = GameSessionFactory.create(GameSessionFactory.Mode.STUB)
	var adapter := GameSessionAdapter.from_session(session)
	var result := adapter.apply_command({
		"command_id": "an1",
		"player_id": "allies",
		"type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "infantry", "count": 1}]},
	})
	assert_eq(result.get("result_type"), "ok")
	assert_true(GameSessionAdapter.validate_event_shape(result["events"][0]))
