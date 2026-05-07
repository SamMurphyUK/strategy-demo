class_name VictoryEngine
extends RefCounted

var state: GameState
var _seq: int = 0

func _init(game_state: GameState, seq_start: int = 0) -> void:
	state = game_state
	_seq = seq_start

func check_victory() -> Array:
	if state.game_over: return []
	for faction in state.factions:
		var controls_all := true
		for rid in state.regions:
			var r: Region = state.regions[rid]
			if r.is_capital and r.owner_faction_id != faction: controls_all = false; break
		if controls_all:
			state.game_over = true
			state.winner = faction
			return [GameEvent.create(GameEvent.Type.GAME_FINISHED, {"winner_faction_id": faction, "reason": "all_enemy_capitals_captured"}, _next_seq())]
	return []

func _next_seq() -> int:
	_seq += 1
	return _seq

func set_sequence(val: int) -> void:
	_seq = val