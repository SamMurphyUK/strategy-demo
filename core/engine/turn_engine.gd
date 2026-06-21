class_name TurnEngine
extends RefCounted

const PHASES := ["purchase", "combat_move", "combat", "noncombat_move", "mobilize", "collect_income"]

var state: GameState
var _seq: int = 0

func _init(game_state: GameState) -> void:
	state = game_state

func start_game() -> Array:
	state.current_faction_id = state.turn_order[0]
	state.current_phase = PHASES[0]
	state.turn_number = 1
	state.game_round = 1
	_record_factories()
	return [GameEvent.create(GameEvent.Type.PHASE_CHANGED, {"faction_id": state.current_faction_id, "new_phase": state.current_phase}, _next_seq())]

func advance_phase() -> Array:
	var old_phase := state.current_phase
	var idx := PHASES.find(state.current_phase)
	if idx < PHASES.size() - 1:
		state.current_phase = PHASES[idx + 1]
		_sync_movement_tracking(old_phase, state.current_phase)
		return [GameEvent.create(GameEvent.Type.PHASE_CHANGED, {"faction_id": state.current_faction_id, "new_phase": state.current_phase}, _next_seq())]
	return []

func end_turn() -> Array:
	var events: Array = []
	events.append(GameEvent.create(GameEvent.Type.TURN_ENDED, {"faction_id": state.current_faction_id, "turn_number": state.turn_number, "game_round": state.game_round}, _next_seq()))
	var idx := state.turn_order.find(state.current_faction_id)
	var next_idx := (idx + 1) % state.turn_order.size()
	state.current_faction_id = state.turn_order[next_idx]
	state.turn_number += 1
	if next_idx == 0: state.game_round += 1
	state.current_phase = PHASES[0]
	state.clear_movement_phase_tracking()
	_record_factories()
	events.append(GameEvent.create(GameEvent.Type.PHASE_CHANGED, {"faction_id": state.current_faction_id, "new_phase": state.current_phase}, _next_seq()))
	return events


func _sync_movement_tracking(old_phase: String, new_phase: String) -> void:
	if old_phase == "purchase" and new_phase == "combat_move":
		state.clear_movement_phase_tracking()
	elif old_phase == "noncombat_move":
		state.clear_movement_phase_tracking()

func _record_factories() -> void:
	var factories: Array = []
	for rid in state.regions:
		var r: Region = state.regions[rid]
		if r.has_factory and r.owner_faction_id == state.current_faction_id: factories.append(rid)
	state.factories_controlled_at_turn_start[state.current_faction_id] = factories

func _next_seq() -> int:
	_seq += 1
	return _seq

func set_sequence(val: int) -> void:
	_seq = val
