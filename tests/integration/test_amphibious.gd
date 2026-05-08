extends GutTest

var session: GameSession


func before_each() -> void:
	session = _create_session()


func test_load_transport_from_adjacent_land() -> void:
	# Skip to combat move
	session.apply_command({"command_id": "c1", "player_id": "red", "type": "end_phase", "payload": {}})
	
	# Load infantry onto transport in sea_west from red_capital
	var result := session.apply_command({
		"command_id": "c2", "player_id": "red", "type": "load_transport",
		"payload": {
			"transport_instance_id": "transport_red_001",
			"from_region_id": "red_capital",
			"units": [{"unit_type_id": "infantry", "count": 2}]
		}
	})
	
	assert_eq(result.result_type, "ok")
	
	# Verify cargo
	var state := session.get_state()
	# Find transport in state
	for region in state.regions:
		for unit in region.units:
			if unit.has("instance_id") and unit.instance_id == "transport_red_001":
				# Would need to check transport_instances in actual implementation
				pass


func test_designate_amphibious_assault() -> void:
	# Skip to combat move
	session.apply_command({"command_id": "c1", "player_id": "red", "type": "end_phase", "payload": {}})
	
	# Load transport
	session.apply_command({
		"command_id": "c2", "player_id": "red", "type": "load_transport",
		"payload": {
			"transport_instance_id": "transport_red_001",
			"from_region_id": "red_capital",
			"units": [{"unit_type_id": "infantry", "count": 2}]
		}
	})
	
	# Designate amphibious assault on blue_capital (sea_west is adjacent)
	var result := session.apply_command({
		"command_id": "c3", "player_id": "red", "type": "designate_amphibious",
		"payload": {
			"transport_instance_id": "transport_red_001",
			"origin_sea_zone_id": "sea_west",
			"target_region_id": "blue_capital"
		}
	})
	
	assert_eq(result.result_type, "ok")
	
	# Check pending assault
	var state := session.get_state()
	assert_eq(state.pending_amphibious_assaults.size(), 1)


func _create_session() -> GameSession:
	return GameSession.create(
		_load_json("res://data/scenarios/minimal/map.json"),
		_load_json("res://data/scenarios/minimal/units.json"),
		_load_json("res://data/scenarios/minimal/factions.json"),
		_load_json("res://data/scenarios/minimal/setup.json"),
		_load_json("res://data/scenarios/minimal/rules.json"),
		{"state": 12345, "sequence": 1}
	)


func _load_json(path: String) -> Dictionary:
	var file := FileAccess.open(path, FileAccess.READ)
	return JSON.parse_string(file.get_as_text())
