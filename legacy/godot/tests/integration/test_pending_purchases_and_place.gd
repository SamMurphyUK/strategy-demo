extends GutTest

func test_pending_purchases_then_place_updates_region() -> void:
	var session = GameSessionFactory.create(GameSessionFactory.Mode.STUB)
	session.apply_command({
		"command_id": "pp1",
		"player_id": "allies",
		"type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "infantry", "count": 1}]},
	})
	for i in 4:
		session.apply_command({"command_id": "pp_adv_%d" % i, "player_id": "allies", "type": "end_phase", "payload": {}})
	var region_id := _first_allies_factory_region(session)
	assert_false(region_id.is_empty(), "Expected an allies factory region in demo map")
	var r = session.apply_command({
		"command_id": "pp_place",
		"player_id": "allies",
		"type": "place_units",
		"payload": {"placements": [{"region_id": region_id, "units": [{"unit_type_id": "infantry", "count": 1}]}]},
	})
	assert_eq(r.get("result_type"), "ok")
	assert_eq(session.get_state()["pending_purchases"]["allies"], [])


func _first_allies_factory_region(session) -> String:
	for rid in session.state.regions.keys():
		var r: Region = session.state.regions[rid]
		if r.owner_faction_id == "allies" and r.has_factory:
			return rid
	return ""
