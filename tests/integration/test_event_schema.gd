extends GutTest

const SCHEMA_PATH := "res://docs/event_schema.json"


func test_event_schema_file_loads() -> void:
	var schema := GameSessionFactory.load_json(SCHEMA_PATH)
	assert_false(schema.is_empty())
	assert_true(schema.has("required"))
	assert_true(schema["required"].has("event_id"))


func test_valid_event_passes_schema() -> void:
	var evt := {
		"event_id": "e00001",
		"sequence": 1,
		"type": "unitspurchased",
		"payload": {"faction_id": "allies"},
		"source_command_id": "cmd1",
		"timestamp": 1680000000,
	}
	assert_true(EventSchemaValidator.validate_event(evt))


func test_missing_field_fails_schema() -> void:
	var evt := {
		"event_id": "e00001",
		"sequence": 1,
		"type": "unitspurchased",
		"payload": {},
	}
	assert_false(EventSchemaValidator.validate_event(evt))


func test_stub_emitted_events_match_schema() -> void:
	var stub := GameSessionStub.new()
	stub.initialize_demo(12345)
	var res := stub.apply_command({
		"command_id": "schema_cmd",
		"player_id": "allies",
		"type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "infantry", "count": 1}]},
	})
	assert_true(EventSchemaValidator.validate_events(res["events"]))
