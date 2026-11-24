extends GutTest

func test_sea_unit_rejected_at_factory_land() -> void:
	var stub := GameSessionStub.new()
	stub.initialize_demo(12345)
	stub.apply_command({
		"command_id": "buy_transport",
		"player_id": "allies",
		"type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "transport", "count": 1}]},
	})
	for i in 4:
		stub.apply_command({
			"command_id": "ep_%d" % i,
			"player_id": "allies",
			"type": "end_phase",
			"payload": {},
		})
	var factory := _first_allies_factory_region(stub)
	var res := stub.apply_command({
		"command_id": "place_ship_on_land",
		"player_id": "allies",
		"type": "place_units",
		"payload": {
			"placements": [{
				"region_id": factory,
				"units": [{"unit_type_id": "transport", "count": 1}],
			}],
		},
	})
	assert_eq(str(res.get("result_type", "")), "error")


func test_sea_unit_placed_in_adjacent_sea_zone() -> void:
	var stub := GameSessionStub.new()
	stub.initialize_demo(12345)
	stub.apply_command({
		"command_id": "buy_transport",
		"player_id": "allies",
		"type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "transport", "count": 1}]},
	})
	for i in 4:
		stub.apply_command({
			"command_id": "ep_%d" % i,
			"player_id": "allies",
			"type": "end_phase",
			"payload": {},
		})
	var factory := _first_allies_factory_region(stub)
	var sea := _sea_zone_adjacent_to(stub, factory)
	if sea.is_empty():
		pending("No sea zone adjacent to allies factory in demo map")
		return
	var res := stub.apply_command({
		"command_id": "place_ship_at_sea",
		"player_id": "allies",
		"type": "place_units",
		"payload": {
			"placements": [{
				"region_id": sea,
				"units": [{"unit_type_id": "transport", "count": 1}],
			}],
		},
	})
	assert_eq(str(res.get("result_type", "")), "ok")


func _first_allies_factory_region(stub: GameSessionStub) -> String:
	for rid in stub.state.regions.keys():
		var r: Region = stub.state.regions[rid]
		if r.owner_faction_id == "allies" and r.has_factory:
			return rid
	return ""


func _sea_zone_adjacent_to(stub: GameSessionStub, region_id: String) -> String:
	for neighbor in stub.state.get_adjacent_regions(region_id):
		var r: Region = stub.state.regions.get(str(neighbor))
		if r != null and r.is_sea_region():
			return str(neighbor)
	return ""
