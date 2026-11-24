extends GutTest

func test_purchase_updates_pending_without_placing_units() -> void:
	var demo_stub := GameSessionStub.new()
	demo_stub.initialize_demo(12345)
	var before := demo_stub.get_state()
	var res := demo_stub.apply_command({
		"command_id": "staging_1",
		"player_id": "allies",
		"type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "infantry", "count": 1}]},
	})
	assert_eq(str(res.get("result_type", "")), "ok")
	assert_true(_has_event(res.get("events", []), "unitspurchased"))
	var after := demo_stub.get_state()
	assert_true(after.get("pending_purchases", {}).has("allies"))
	assert_eq(int((after.get("pending_purchases", {}).get("allies", [])[0]).get("count", 0)), 1)
	assert_eq(_total_units(before), _total_units(after))

func _has_event(events: Array, type_name: String) -> bool:
	for e in events:
		if str(e.get("type", "")) == type_name:
			return true
	return false

func _total_units(snapshot: Dictionary) -> int:
	var total := 0
	for region_entry in snapshot.get("regions", []):
		for u in region_entry.get("units", []):
			total += int(u.get("count", 0))
	return total
