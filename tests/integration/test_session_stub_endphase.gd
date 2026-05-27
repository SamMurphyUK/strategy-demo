extends GutTest

var stub: GameSessionStub


func before_each() -> void:
	stub = GameSessionStub.new()
	stub.initialize_demo(12345)


func test_mobilize_end_phase_forfeits_pending_purchases() -> void:
	stub.apply_command({
		"command_id": "cmd_purchase",
		"player_id": "allies",
		"type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "infantry", "count": 2}]},
	})
	_advance_to_mobilize(stub)
	assert_gt(stub.get_state()["pending_purchases"]["allies"].size(), 0)

	var res := stub.apply_command({
		"command_id": "cmd_end_mobilize",
		"player_id": "allies",
		"type": "end_phase",
		"payload": {},
	})
	assert_eq(res["result_type"], "ok")
	var found_forfeit := false
	for evt in res["events"]:
		if str(evt.get("type", "")) == "placementforfeited":
			found_forfeit = true
			break
	assert_true(found_forfeit, "Expected placementforfeited event")
	assert_eq(stub.get_state()["pending_purchases"]["allies"], [])


func _advance_to_mobilize(s: GameSessionStub) -> void:
	for i in 4:
		s.apply_command({
			"command_id": "adv_%d" % i,
			"player_id": "allies",
			"type": "end_phase",
			"payload": {},
		})
	assert_eq(s.state.current_phase, "mobilize")
