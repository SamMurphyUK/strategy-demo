class_name StartTurnPhaseController
extends Object

signal start_turn_completed(result: StartTurnPhaseResultResource)
signal start_turn_failed(result: StartTurnPhaseResultResource)


func start_turn(
	request: StartTurnRequestResource,
	turn_engine: TurnEngine
) -> StartTurnPhaseResultResource:
	var result := StartTurnPhaseResultResource.new()
	var events: Array = turn_engine.start_game()
	result.game_events = events
	result.success = _turn_started(events)

	if result.success:
		start_turn_completed.emit(result)
	else:
		result.error_code = "START_TURN_FAILED"
		result.error_message = "start_turn_failed"
		start_turn_failed.emit(result)

	return result


func _turn_started(events: Array) -> bool:
	if events.is_empty():
		return false
	var first: GameEvent = events[0]
	return first.type == GameEvent.Type.PHASE_CHANGED
