extends GutTest

const TestStateBuilder := preload("res://tests/validator/helpers/test_state_builder.gd")


func test_transport_instance_can_move_two_sea_zones() -> void:
	var stub := GameSessionStub.new()
	stub.initialize_demo(12345)
	stub.apply_command({
		"command_id": "buy_transport",
		"player_id": "allies",
		"type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "transport", "count": 1}]},
	})
	for i in 3:
		stub.apply_command({
			"command_id": "ep_%d" % i,
			"player_id": "allies",
			"type": "end_phase",
			"payload": {},
		})
	var factory := _first_allies_factory_region(stub)
	var sea := _sea_zone_adjacent_to(stub, factory)
	if sea.is_empty():
		pending("No adjacent sea zone")
		return
	stub.apply_command({
		"command_id": "place_transport",
		"player_id": "allies",
		"type": "place_units",
		"payload": {
			"placements": [{
				"region_id": sea,
				"units": [{"unit_type_id": "transport", "count": 1}],
			}],
		},
	})
	var transport_id := _first_transport_in_region(stub, sea)
	assert_false(transport_id.is_empty())
	var dest := _reachable_sea_two_away(stub, sea)
	if dest.is_empty():
		pending("No two-hop sea destination in demo map")
		return
	var res := stub.apply_command({
		"command_id": "move_transport",
		"player_id": "allies",
		"type": "move_units",
		"payload": {
			"moves": [{
				"from_region_id": sea,
				"to_region_id": dest,
				"units": [{
					"unit_type_id": "transport",
					"count": 1,
					"instance_id": transport_id,
				}],
			}],
		},
	})
	assert_eq(str(res.get("result_type", "")), "ok")
	assert_eq(str(stub.state.transport_instances[transport_id].region_id), dest)


func test_load_infantry_onto_adjacent_transport() -> void:
	var stub := GameSessionStub.new()
	stub.initialize_demo(12345)
	for i in 1:
		stub.apply_command({
			"command_id": "ep_%d" % i,
			"player_id": "allies",
			"type": "end_phase",
			"payload": {},
		})
	var pair := _land_sea_with_transport(stub, "allies")
	if pair.is_empty():
		pending("No land/sea transport setup on demo map")
		return
	var res := stub.apply_command({
		"command_id": "load_inf",
		"player_id": "allies",
		"type": "load_transport",
		"payload": {
			"transport_instance_id": pair["transport_id"],
			"from_region_id": pair["land"],
			"units": [{"unit_type_id": "infantry", "count": 1}],
		},
	})
	assert_eq(str(res.get("result_type", "")), "ok")
	assert_eq(stub.state.transport_instances[pair["transport_id"]].cargo.size(), 1)


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


func _first_transport_in_region(stub: GameSessionStub, region_id: String) -> String:
	for entry in stub.state.get_units_in_region(region_id):
		if entry.has("instance_id"):
			return str(entry.instance_id)
	return ""


func _reachable_sea_two_away(stub: GameSessionStub, start: String) -> String:
	var validator := MovementValidator.new()
	var legal: Array = validator.get_legal_destinations_for_instance(
		_first_transport_in_region(stub, start),
		"allies",
		stub.state,
		stub.ruleset
	)
	for dest in legal:
		if dest != start and not stub.state.is_adjacent(start, str(dest)):
			return str(dest)
	return ""


func _land_sea_with_transport(stub: GameSessionStub, faction: String) -> Dictionary:
	for rid in stub.state.regions.keys():
		var r: Region = stub.state.regions[rid]
		if not r.is_land_region():
			continue
		for neighbor in stub.state.get_adjacent_regions(rid):
			var sea: Region = stub.state.regions.get(str(neighbor))
			if sea == null or not sea.is_sea_region():
				continue
			for entry in stub.state.get_faction_units_in_region(str(neighbor), faction):
				if entry.has("instance_id") and str(entry.get("unit_type_id", "")) == "transport":
					return {
						"land": rid,
						"sea": str(neighbor),
						"transport_id": str(entry.instance_id),
					}
	return {}
