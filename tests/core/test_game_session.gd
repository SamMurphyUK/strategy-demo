extends GutTest

var session: GameSession

func before_each() -> void:
	var map := _load_json("res://data/scenarios/minimal/map.json")
	var units := _load_json("res://data/scenarios/minimal/units.json")
	var factions := _load_json("res://data/scenarios/minimal/factions.json")
	var setup := _load_json("res://data/scenarios/minimal/setup.json")
	var rules := _load_json("res://data/scenarios/minimal/rules.json")
	session = GameSession.create(map, units, factions, setup, rules, {"state": 12345, "sequence": 1})

func test_initial_state() -> void:
	var state := session.get_state()
	assert_eq(state.turn_info.current_faction_id, "red")
	assert_eq(state.turn_info.current_phase, "purchase")

func test_end_phase() -> void:
	var result := session.apply_command({"command_id": "c1", "player_id": "red", "type": "end_phase", "payload": {}})
	assert_eq(result.result_type, "ok")
	assert_eq(result.new_state.turn_info.current_phase, "combat_move")

func _load_json(path: String) -> Dictionary:
	var file := FileAccess.open(path, FileAccess.READ)
	return JSON.parse_string(file.get_as_text())
