extends GutTest

var state: GameState
var engine: TurnEngine


func before_each() -> void:
	state = GameState.new()
	state.turn_order = ["red", "blue"]
	
	state.factions["red"] = Faction.from_dict({
		"id": "red", "name": "Red", "color": "#FF0000", "starting_ipc": 20
	})
	state.factions["blue"] = Faction.from_dict({
		"id": "blue", "name": "Blue", "color": "#0000FF", "starting_ipc": 15
	})
	
	state.regions["capital"] = Region.from_dict({
		"id": "capital", "name": "Capital", "type": "land",
		"ipc_value": 10, "owner_faction_id": "red",
		"is_capital": true, "has_factory": true
	})
	
	engine = TurnEngine.new(state)


func test_start_game_sets_initial_state() -> void:
	var events := engine.start_game()
	
	assert_eq(state.current_faction_id, "red", "First faction should be red")
	assert_eq(state.current_phase, "purchase", "First phase should be purchase")
	assert_eq(state.turn_number, 1, "Turn number should be 1")
	assert_eq(state.game_round, 1, "Game round should be 1")


func test_start_game_emits_phase_changed() -> void:
	var events := engine.start_game()
	
	assert_eq(events.size(), 1, "Should emit 1 event")
	assert_eq(events[0].type, GameEvent.Type.PHASE_CHANGED)
	assert_eq(events[0].payload.faction_id, "red")
	assert_eq(events[0].payload.new_phase, "purchase")


func test_start_game_records_factories() -> void:
	engine.start_game()
	
	var factories: Array = state.factories_controlled_at_turn_start.get("red", [])
	assert_true("capital" in factories, "Should record capital as factory")


func test_advance_phase_cycles_through_all_phases() -> void:
	engine.start_game()
	
	var expected_phases := ["combat_move", "combat", "noncombat_move", "mobilize", "collect_income"]
	
	for expected in expected_phases:
		var events := engine.advance_phase()
		assert_eq(state.current_phase, expected, "Phase should be %s" % expected)
		assert_eq(events.size(), 1, "Should emit phase_changed event")
		assert_eq(events[0].type, GameEvent.Type.PHASE_CHANGED)


func test_advance_phase_stops_at_collect_income() -> void:
	engine.start_game()
	
	for i in range(5):
		engine.advance_phase()
	
	assert_eq(state.current_phase, "collect_income")
	
	var events := engine.advance_phase()
	assert_eq(events.size(), 0, "Should not advance past collect_income")
	assert_eq(state.current_phase, "collect_income")


func test_end_turn_switches_faction() -> void:
	engine.start_game()
	state.current_phase = "collect_income"
	
	var events := engine.end_turn()
	
	assert_eq(state.current_faction_id, "blue", "Should switch to blue")
	assert_eq(state.current_phase, "purchase", "Should reset to purchase")
	assert_eq(state.turn_number, 2, "Turn number should increment")


func test_end_turn_increments_round_after_all_factions() -> void:
	engine.start_game()
	state.current_phase = "collect_income"
	
	engine.end_turn()
	assert_eq(state.game_round, 1, "Still round 1 after red")
	
	state.current_phase = "collect_income"
	engine.end_turn()
	
	assert_eq(state.current_faction_id, "red", "Back to red")
	assert_eq(state.game_round, 2, "Now round 2")


func test_end_turn_emits_turn_ended_and_phase_changed() -> void:
	engine.start_game()
	state.current_phase = "collect_income"
	
	var events := engine.end_turn()
	
	assert_eq(events.size(), 2, "Should emit 2 events")
	assert_eq(events[0].type, GameEvent.Type.TURN_ENDED)
	assert_eq(events[1].type, GameEvent.Type.PHASE_CHANGED)
