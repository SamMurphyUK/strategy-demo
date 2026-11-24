class_name PlaceUnitsPhaseController
extends Object

signal place_units_completed(result: PlaceUnitsPhaseResultResource)
signal place_units_failed(result: PlaceUnitsPhaseResultResource)


func process_placement(
	batch: PlaceUnitsBatchResource,
	placement_engine: PlacementEngine,
	cmd: Command
) -> PlaceUnitsPhaseResultResource:
	var result := PlaceUnitsPhaseResultResource.new()
	var events: Array = placement_engine.process_placement(cmd)
	result.game_events = events
	result.success = _placement_succeeded(events)

	if result.success:
		place_units_completed.emit(result)
	else:
		result.error_code = "PLACEMENT_FAILED"
		result.error_message = "placement_failed"
		place_units_failed.emit(result)

	return result


func _placement_succeeded(events: Array) -> bool:
	if events.is_empty():
		return false
	var first: GameEvent = events[0]
	return first.type == GameEvent.Type.UNITS_PLACED
