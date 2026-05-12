extends GutTest

var loader: ContentLoader
var state: GameState


func before_each() -> void:
	loader = ContentLoader.new()
	state = loader.load_scenario("res://data/scenario_1940_minimal.json")


func test_scenario_loaded() -> void:
	assert_not_null(state)
	assert_true(state.factions.has("germany"))
	assert_true(state.factions.has("uk"))
	assert_true(state.regions.has("germany"))
	assert_true(state.regions.has("uk"))
	assert_true(state.region_units.has("germany"))


func test_starting_ipc_and_units() -> void:
	assert_eq(state.get_faction_ipc("germany"), 30)
	assert_eq(state.get_faction_ipc("uk"), 28)
	
	var ger_units: Array = state.region_units["germany"]
	var inf_count := 0
	for u in ger_units:
		if u.unit_type_id == "infantry":
			inf_count += u.count
	assert_eq(inf_count, 6)


func test_rules_and_turn_order() -> void:
	assert_eq(state.rules.victory_conditions.type, "all_enemy_capitals")
	assert_eq(state.current_phase, "purchase")
	assert_eq(state.game_round, 1)
	assert_true(state.current_faction_id in ["germany", "uk"])
