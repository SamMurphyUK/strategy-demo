extends GutTest

var demo_stub: GameSessionStub


func before_each() -> void:
	demo_stub = GameSessionStub.new()
	demo_stub.initialize_demo(12345)


func test_snapshot_includes_cost_table_and_applied_event_ids() -> void:
	var snap := demo_stub.get_state()
	assert_true(snap.has("cost_table"))
	assert_true(snap.has("pending_purchases"))
	assert_true(snap.has("applied_event_ids"))
	assert_eq(snap["cost_table"]["infantry"], 3)


func test_rejects_purchase_when_ipc_insufficient() -> void:
	demo_stub.state.ipc["allies"] = 2
	var res := demo_stub.apply_command({
		"command_id": "cmd_no_ipc",
		"player_id": "allies",
		"type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "infantry", "count": 1}]},
	})
	assert_eq(res["result_type"], "error")
	assert_eq(res["error"]["code"], "PURCHASE_FAILED")
	assert_eq(res["events"][0]["type"], "purchasefailed")
	assert_false(_has_event_type(res["events"], "unitspurchased"))


func test_successful_purchase_emits_unitspurchased_only() -> void:
	var res := demo_stub.apply_command({
		"command_id": "cmd_ok",
		"player_id": "allies",
		"type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "infantry", "count": 1}]},
	})
	assert_eq(res["result_type"], "ok")
	assert_true(_has_event_type(res["events"], "unitspurchased"))
	assert_false(_has_event_type(res["events"], "purchasefailed"))


func test_duplicate_command_id_returns_prior_result() -> void:
	var cmd := {
		"command_id": "cmd_dup",
		"player_id": "allies",
		"type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "infantry", "count": 1}]},
	}
	var first := demo_stub.apply_command(cmd)
	var ipc_after_first: int = demo_stub.get_state()["ipc"]["allies"]
	var second := demo_stub.apply_command(cmd)
	assert_eq(first, second)
	assert_eq(demo_stub.get_state()["ipc"]["allies"], ipc_after_first)


func test_place_rejects_unowned_region() -> void:
	demo_stub.apply_command({
		"command_id": "p1",
		"player_id": "allies",
		"type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "infantry", "count": 1}]},
	})
	_advance_to_mobilize(demo_stub)
	var res := demo_stub.apply_command({
		"command_id": "pl1",
		"player_id": "allies",
		"type": "place_units",
		"payload": {
			"placements": [{
				"region_id": _axis_factory_region(demo_stub),
				"units": [{"unit_type_id": "infantry", "count": 1}],
			}],
		},
	})
	assert_eq(res["result_type"], "error")
	assert_eq(res["error"]["code"], "PLACEMENT_INVALID")


func test_mobilize_end_forfeits_pending_and_emits_event() -> void:
	demo_stub.apply_command({
		"command_id": "p2",
		"player_id": "allies",
		"type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "infantry", "count": 1}]},
	})
	_advance_to_mobilize(demo_stub)
	var res := demo_stub.apply_command({
		"command_id": "ep1",
		"player_id": "allies",
		"type": "end_phase",
		"payload": {},
	})
	assert_eq(res["result_type"], "ok")
	assert_true(_has_event_type(res["events"], "placementforfeited"))
	assert_eq(demo_stub.get_state()["pending_purchases"]["allies"], [])


func test_events_conform_to_schema() -> void:
	var res := demo_stub.apply_command({
		"command_id": "schema1",
		"player_id": "allies",
		"type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "infantry", "count": 1}]},
	})
	for evt in res["events"]:
		assert_true(EventSchemaValidator.validate_event(evt))
		assert_true(GameSessionStub.validate_event_shape(evt))
		assert_false(str(evt["event_id"]).is_empty())
		assert_false(str(evt["source_command_id"]).is_empty())


func test_deterministic_with_same_seed() -> void:
	var a := GameSessionStub.new()
	a.initialize_demo(777)
	var b := GameSessionStub.new()
	b.initialize_demo(777)
	var cmd := {
		"command_id": "d1",
		"player_id": "allies",
		"type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "infantry", "count": 1}]},
	}
	var ra := a.apply_command(cmd)
	var rb := b.apply_command(cmd)
	assert_eq(ra["events"][0]["type"], rb["events"][0]["type"])
	assert_eq(a.get_state()["ipc"], b.get_state()["ipc"])


func _has_event_type(events: Array, type_name: String) -> bool:
	for evt in events:
		if str(evt.get("type", "")) == type_name:
			return true
	return false


func _advance_to_mobilize(s: GameSessionStub) -> void:
	for i in 4:
		s.apply_command({
			"command_id": "adv_%d_%d" % [s.get_demo_seed(), i],
			"player_id": "allies",
			"type": "end_phase",
			"payload": {},
		})
	assert_eq(s.state.current_phase, "mobilize")


func _axis_factory_region(s: GameSessionStub) -> String:
	for rid in s.state.regions.keys():
		var r: Region = s.state.regions[rid]
		if r.owner_faction_id == "axis" and r.has_factory:
			return rid
	return "region_2"
