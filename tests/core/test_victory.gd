extends GutTest

var state: GameState
var victory: VictoryEngine


func before_each() -> void:
	state = GameState.new()
	
	state.factions["red"] = Faction.from_dict({
		"id": "red", "name": "Red", "color": "#FF0000", "starting_ipc": 20
	})
	state.factions["blue"] = Faction.from_dict({
		"id": "blue", "name": "Blue", "color": "#0000FF", "starting_ipc": 20
	})
	
	state.regions["red_capital"] = Region.from_dict({
		"id": "red_capital", "name": "Red Capital", "type": "land",
		"ipc_value": 8, "owner_faction_id": "red",
		"is_capital": true, "has_factory": true
	})
	state.regions["blue_capital"] = Region.from_dict({
		"id": "blue_capital", "name": "Blue Capital", "type": "land",
		"ipc_value": 8, "owner_faction_id": "blue",
		"is_capital": true, "has_factory": true
	})
	
	state.rules = {"victory_conditions": {"type": "all_enemy_capitals"}}
	state.game_over = false
	state.winner_faction_id = ""
	
	victory = VictoryEngine.new(state)


func test_no_victory_initially() -> void:
	var events := victory.check_victory()
	
	assert_eq(events.size(), 0)
	assert_false(state.game_over)


func test_victory_when_all_capitals_captured() -> void:
	state.regions["blue_capital"].owner_faction_id = "red"
	
	var events := victory.check_victory()
	
	assert_eq(events.size(), 1)
	assert_eq(events[0].type, GameEvent.Type.GAME_FINISHED)
	assert_true(state.game_over)
	assert_eq(state.winner_faction_id, "red")


func test_no_victory_with_partial_capture() -> void:
	state.regions["neutral_capital"] = Region.from_dict({
		"id": "neutral_capital", "name": "Neutral", "type": "land",
		"ipc_value": 5, "owner_faction_id": "neutral",
		"is_capital": true, "has_factory": true
	})
	state.factions["neutral"] = Faction.from_dict({
		"id": "neutral", "name": "Neutral", "color": "#888888", "starting_ipc": 10
	})
	
	state.regions["blue_capital"].owner_faction_id = "red"
	
	var events := victory.check_victory()
	
	assert_eq(events.size(), 0)
	assert_false(state.game_over)


func test_victory_event_payload() -> void:
	state.regions["blue_capital"].owner_faction_id = "red"
	
	var events := victory.check_victory()
	
	assert_eq(events.size(), 1)
	assert_eq(events[0].payload.winner_faction_id, "red")
	assert_eq(events[0].payload.reason, "all_enemy_capitals_captured")


func test_no_double_victory() -> void:
	state.regions["blue_capital"].owner_faction_id = "red"
	
	victory.check_victory()
	var events := victory.check_victory()
	
	assert_eq(events.size(), 0)
	assert_true(state.game_over)
