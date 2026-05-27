class_name EndPhaseController
extends Object

signal end_phase_completed(result: EndPhaseResultResource)


func process_end_phase(
	request: EndPhaseRequestResource,
	game_state: GameState,
	turn_engine: TurnEngine,
	amphibious_engine: AmphibiousEngine,
	combat_engine: CombatEngine,
	battle_phase_controller: BattlePhaseController,
	placement_engine: PlacementEngine,
	sync_seq: Callable
) -> EndPhaseResultResource:
	var result := EndPhaseResultResource.new()
	var events: Array = []
	var phase := request.phase_at_request

	if phase == "combat_move":
		events.append_array(sync_seq.call(turn_engine.advance_phase()))
		var battle_request: BattlePhaseRequestResource = (
			BattlePhaseRequestResource.from_faction(game_state.current_faction_id)
		)
		var battle_result: BattlePhaseResultResource = battle_phase_controller.resolve_phase(
			battle_request,
			amphibious_engine,
			combat_engine,
			sync_seq
		)
		events.append_array(battle_result.get_events())
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
