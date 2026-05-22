class_name EndPhaseController
extends Object

signal end_phase_completed(result: EndPhaseResultResource)


func process_end_phase(
	request: EndPhaseRequestResource,
	game_state: GameState,
	turn_engine: TurnEngine,
	amphibious_engine: AmphibiousEngine,
	combat_engine: CombatEngine,
	placement_engine: PlacementEngine,
	sync_seq: Callable
) -> EndPhaseResultResource:
	var result := EndPhaseResultResource.new()
	var events: Array = []
	var phase := request.phase_at_request

	if phase == "combat_move":
		events.append_array(sync_seq.call(turn_engine.advance_phase()))
		events.append_array(sync_seq.call(
			amphibious_engine.resolve_assaults(game_state.current_faction_id, combat_engine)
		))
		events.append_array(sync_seq.call(
			combat_engine.resolve_all_battles(game_state.current_faction_id)
		))
		events.append_array(sync_seq.call(turn_engine.advance_phase()))

	elif phase == "mobilize":
		events.append_array(sync_seq.call(
			placement_engine.check_forfeited(game_state.current_faction_id)
		))
		events.append_array(sync_seq.call(turn_engine.advance_phase()))

	else:
		events.append_array(sync_seq.call(turn_engine.advance_phase()))

	result.game_events = events
	result.success = true
	end_phase_completed.emit(result)
	return result
