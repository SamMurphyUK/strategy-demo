extends GutTest

func test_place_units_emits_unitsplaced_and_updates_snapshot() -> void:
	var demo_stub := GameSessionStub.new()
	demo_stub.initialize_demo(12345)
	demo_stub.apply_command({
		"command_id": "drag_p1",
		"player_id": "allies",
		"type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "infantry", "count": 1}]},
	})
	for i in 4:
		demo_stub.apply_command({"command_id": "drag_ep_%d" % i, "player_id": "allies", "type": "end_phase", "payload": {}})
	var region_id := _first_allies_factory_region(demo_stub)
	var place := demo_stub.apply_command({
		"command_id": "drag_place",
		"player_id": "allies",
		"type": "place_units",
		"payload": {"placements": [{"region_id": region_id, "units": [{"unit_type_id": "infantry", "count": 1}]}]},
	})
	assert_eq(str(place.get("result_type", "")), "ok")
	assert_true(_has_event(place.get("events", []), "unitsplaced"))
	assert_true(_region_has_infantry(demo_stub.get_state(), region_id))

func _first_allies_factory_region(stub: GameSessionStub) -> String:
	for rid in stub.state.regions.keys():
		var r: Region = stub.state.regions[rid]
		if r.owner_faction_id == "allies" and r.has_factory:
			return rid
	return "region_1"

func _region_has_infantry(snap: Dictionary, region_id: String) -> bool:
	for r in snap.get("regions", []):
		if str(r.get("region_id", "")) != region_id:
			continue
		for u in r.get("units", []):
			if str(u.get("unit_type_id", "")) == "infantry" and int(u.get("count", 0)) > 0:
				return true
	return false

func _has_event(events: Array, type_name: String) -> bool:
	for e in events:
		if str(e.get("type", "")) == type_name:
			return true
	return false
