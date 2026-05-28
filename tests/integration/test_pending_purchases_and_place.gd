extends GutTest

func test_pending_purchases_then_place_updates_region() -> void:
	var session = GameSessionFactory.create(GameSessionFactory.Mode.STUB)
	session.apply_command({
		"command_id": "pp1",
		"player_id": "allies",
		"type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "infantry", "count": 1}]},
	})
	for i in 3:
		session.apply_command({"command_id": "pp_adv_%d" % i, "player_id": "allies", "type": "end_phase", "payload": {}})
	var region_id := "region_1"
	var r = session.apply_command({
		"command_id": "pp_place",
		"player_id": "allies",
		"type": "place_units",
		"payload": {"placements": [{"region_id": region_id, "units": [{"unit_type_id": "infantry", "count": 1}]}]},
	})
	assert_eq(r.get("result_type"), "ok")
	assert_eq(session.get_state()["pending_purchases"]["allies"], [])
