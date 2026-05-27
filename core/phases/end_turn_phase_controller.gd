class_name EndTurnPhaseController
extends Object

signal end_turn_completed(result: EndTurnPhaseResultResource)


func process_end_turn(
	request: EndTurnRequestResource,
	game_state: GameState,
	economy_engine: EconomyEngine,
	victory_engine: VictoryEngine,
	turn_engine: TurnEngine,
	sync_seq: Callable
) -> EndTurnPhaseResultResource:
	var result := EndTurnPhaseResultResource.new()
	var events: Array = []

	if request.phase_at_request == "collect_income":
		events.append_array(sync_seq.call(
			economy_engine.collect_income(request.faction_id)
		))

	events.append_array(sync_seq.call(victory_engine.check_victory()))

	if not game_state.game_over:
		events.append_array(sync_seq.call(turn_engine.end_turn()))

	result.game_events = events
	result.success = true
	end_turn_completed.emit(result)
	return result
