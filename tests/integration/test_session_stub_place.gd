extends GutTest

var demo_stub: GameSessionStub


func before_each() -> void:
	demo_stub = GameSessionStub.new()
	demo_stub.initialize_demo(12345)


func test_place_consumes_pending_and_updates_region_units() -> void:
	demo_stub.apply_command({
		"command_id": "cmd_purchase",
		"player_id": "allies",
		"type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "infantry", "count": 1}]},
	})
	_advance_to_mobilize(demo_stub)

	var region_id := _first_allies_factory_region(demo_stub)
	var count_before := _infantry_count_in_region(demo_stub, region_id)

	var res := demo_stub.apply_command({
		"command_id": "cmd_place",
		"player_id": "allies",
		"type": "place_units",
		"payload": {
			"placements": [{
				"region_id": region_id,
				"units": [{"unit_type_id": "infantry", "count": 1}],
			}],
		},
	})
	assert_eq(res["result_type"], "ok")
	assert_eq(res["events"][0]["type"], "unitsplaced")
	assert_eq(demo_stub.get_state()["pending_purchases"]["allies"], [])
	assert_eq(_infantry_count_in_region(demo_stub, region_id), count_before + 1)


func _advance_to_mobilize(s: GameSessionStub) -> void:
	for i in 3:
		s.apply_command({
			"command_id": "adv_%d" % i,
			"player_id": "allies",
			"type": "end_phase",
			"payload": {},
		})
	assert_eq(s.state.current_phase, "mobilize")


func _first_allies_factory_region(s: GameSessionStub) -> String:
	for rid in s.state.regions.keys():
		var r: Region = s.state.regions[rid]
		if r.owner_faction_id == "allies" and r.has_factory:
			return rid
	return "region_1"


func _infantry_count_in_region(s: GameSessionStub, region_id: String) -> int:
	var total := 0
	for u in s.state.get_units_in_region(region_id):
		if str(u.get("unit_type_id", "")) == "infantry":
			total += int(u.get("count", 0))
	return total
