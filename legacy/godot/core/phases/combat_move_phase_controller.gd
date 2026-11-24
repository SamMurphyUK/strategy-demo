class_name CombatMovePhaseController
extends Object

signal combat_move_completed(result: CombatMovePhaseResultResource)
signal combat_move_failed(result: CombatMovePhaseResultResource)

signal combat_load_completed(result: CombatMovePhaseResultResource)
signal combat_load_failed(result: CombatMovePhaseResultResource)

signal amphibious_designated(result: CombatMovePhaseResultResource)
signal amphibious_designation_failed(result: CombatMovePhaseResultResource)


func process_move(
	batch: CombatMoveBatchResource,
	movement_engine: MovementEngine,
	cmd: Command
) -> CombatMovePhaseResultResource:
	var result := CombatMovePhaseResultResource.new()
	var events: Array = movement_engine.process_move(cmd)
	result.game_events = events
	result.success = _has_event_type(events, GameEvent.Type.UNITS_MOVED)
	return _finalize_move_result(result)


func process_load(
	batch: CombatLoadTransportBatchResource,
	movement_engine: MovementEngine,
	cmd: Command
) -> CombatMovePhaseResultResource:
	var result := CombatMovePhaseResultResource.new()
	var events: Array = movement_engine.process_load(cmd)
	result.game_events = events
	result.success = _has_event_type(events, GameEvent.Type.TRANSPORT_LOADED)
	return _finalize_load_result(result)


func designate_amphibious(
	designation: AmphibiousDesignationResource,
	amphibious_engine: AmphibiousEngine,
	cmd: Command
) -> CombatMovePhaseResultResource:
	var result := CombatMovePhaseResultResource.new()
	var events: Array = amphibious_engine.designate_assault(cmd)
	result.game_events = events
	result.success = _has_event_type(events, GameEvent.Type.AMPHIBIOUS_DECLARED)
	return _finalize_amphibious_result(result)


func _finalize_move_result(result: CombatMovePhaseResultResource) -> CombatMovePhaseResultResource:
	if result.success:
		combat_move_completed.emit(result)
	else:
		result.error_code = "COMBAT_MOVE_FAILED"
		result.error_message = "combat_move_failed"
		combat_move_failed.emit(result)
	return result


func _finalize_load_result(result: CombatMovePhaseResultResource) -> CombatMovePhaseResultResource:
	if result.success:
		combat_load_completed.emit(result)
	else:
		result.error_code = "COMBAT_LOAD_FAILED"
		result.error_message = "combat_load_failed"
		combat_load_failed.emit(result)
	return result


func _finalize_amphibious_result(result: CombatMovePhaseResultResource) -> CombatMovePhaseResultResource:
	if result.success:
		amphibious_designated.emit(result)
	else:
		result.error_code = "AMPHIBIOUS_DESIGNATION_FAILED"
		result.error_message = "amphibious_designation_failed"
		amphibious_designation_failed.emit(result)
	return result


func _has_event_type(events: Array, event_type: GameEvent.Type) -> bool:
	if events.is_empty():
		return false
	var first: GameEvent = events[0]
	return first.type == event_type
