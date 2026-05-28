extends GutTest

func test_end_turn_switches_faction_and_resets_phase() -> void:
	var demo_stub := GameSessionStub.new()
	demo_stub.initialize_demo(12345)
	for i in 5:
		demo_stub.apply_command({"command_id": "turn_ep_%d" % i, "player_id": "allies", "type": "end_phase", "payload": {}})
	var before = demo_stub.get_state().get("turn_info", {})
	var res := demo_stub.apply_command({"command_id": "turn_end", "player_id": "allies", "type": "end_turn", "payload": {}})
	var after = demo_stub.get_state().get("turn_info", {})
	assert_eq(str(res.get("result_type", "")), "ok")
	assert_ne(str(before.get("current_faction_id", "")), str(after.get("current_faction_id", "")))
	assert_eq(str(after.get("current_phase", "")), "purchase")
