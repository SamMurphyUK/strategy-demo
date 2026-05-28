extends GutTest


func test_normalizes_stub_event() -> void:
	var demo_stub := GameSessionStub.new()
	demo_stub.initialize_demo(42)
	var adapter := GameSessionAdapter.from_session(demo_stub)
	var res := adapter.apply_command({
		"command_id": "norm_stub",
		"player_id": "allies",
		"type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "infantry", "count": 1}]},
	})
	var evt: Dictionary = res["events"][0]
	_assert_normalized(evt, "norm_stub")


func test_normalizes_full_engine_style_event() -> void:
	var adapter := GameSessionAdapter.from_session(null)
	var raw := GameEvent.create(
		GameEvent.Type.UNITS_PURCHASED,
		{"faction_id": "allies", "units": [{"unit_type_id": "infantry", "count": 1}], "cost": 3},
		5
	)
	var normalized := adapter._to_canonical_event(raw, "full_cmd_1")
	_assert_normalized(normalized, "full_cmd_1")
	assert_eq(normalized["type"], "unitspurchased")
	assert_eq(normalized["event_id"], "e00005")


func test_normalizes_underscore_event_id() -> void:
	var adapter := GameSessionAdapter.from_session(null)
	var raw_dict := {
		"event_id": "e_00012",
		"sequence": 12,
		"type": "units_placed",
		"payload": {"faction_id": "allies"},
	}
	var normalized := adapter._to_canonical_event(raw_dict, "cmd_x")
	assert_eq(normalized["event_id"], "e00012")
	assert_eq(normalized["type"], "unitsplaced")
	assert_eq(normalized["source_command_id"], "cmd_x")


func _assert_normalized(evt: Dictionary, expected_source: String) -> void:
	assert_true(GameSessionAdapter.validate_event_shape(evt))
	assert_true(EventSchemaValidator.validate_event(evt))
	assert_eq(evt["source_command_id"], expected_source)
	assert_true(evt.has("timestamp"))
	assert_true(typeof(evt["timestamp"]) == TYPE_INT)
