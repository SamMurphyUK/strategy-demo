extends GutTest

func test_end_turn_collects_income_from_owned_land() -> void:
	var stub := GameSessionStub.new()
	stub.initialize_demo(12345)
	for i in 5:
		stub.apply_command({
			"command_id": "ep_%d" % i,
			"player_id": "allies",
			"type": "end_phase",
			"payload": {},
		})
	assert_eq(stub.state.current_phase, "collect_income")

	var expected_income := stub.economy.calculate_income("allies")
	var ipc_before := stub.state.get_faction_ipc("allies")
	assert_gt(expected_income, 0, "Demo allies should control land with IPC value")

	var res := stub.apply_command({
		"command_id": "turn_end",
		"player_id": "allies",
		"type": "end_turn",
		"payload": {},
	})
	assert_eq(str(res.get("result_type", "")), "ok")
	assert_true(_has_event_type(res.get("events", []), "incomecollected"))
	assert_eq(stub.state.get_faction_ipc("allies"), ipc_before + expected_income)
	assert_eq(stub.state.current_faction_id, "axis")


func _has_event_type(events: Array, type_name: String) -> bool:
	for evt in events:
		if str(evt.get("type", "")) == type_name:
			return true
	return false
