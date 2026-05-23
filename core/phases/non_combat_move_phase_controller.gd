class_name NonCombatMovePhaseController
extends Object

signal non_combat_move_completed(result: NonCombatMovePhaseResultResource)
signal non_combat_move_failed(result: NonCombatMovePhaseResultResource)


func process_move(
	batch: NonCombatMoveBatchResource,
	movement_engine: MovementEngine,
	cmd: Command
) -> NonCombatMovePhaseResultResource:
	var result := NonCombatMovePhaseResultResource.new()
	var events: Array = movement_engine.process_move(cmd)
	result.game_events = events
	result.success = _move_succeeded(events)

	if result.success:
		non_combat_move_completed.emit(result)
	else:
		result.error_code = "NON_COMBAT_MOVE_FAILED"
		result.error_message = "non_combat_move_failed"
		non_combat_move_failed.emit(result)

	return result


func _move_succeeded(events: Array) -> bool:
	if events.is_empty():
		return false
	var first: GameEvent = events[0]
	return first.type == GameEvent.Type.UNITS_MOVED
