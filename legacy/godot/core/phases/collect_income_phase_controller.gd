class_name CollectIncomePhaseController
extends Object

signal collect_income_completed(result: CollectIncomePhaseResultResource)
signal collect_income_failed(result: CollectIncomePhaseResultResource)


func collect_income(
	request: CollectIncomeRequestResource,
	economy_engine: EconomyEngine
) -> CollectIncomePhaseResultResource:
	var result := CollectIncomePhaseResultResource.new()
	var events: Array = economy_engine.collect_income(request.faction_id)
	result.game_events = events
	result.success = _income_collected(events)

	if result.success:
		collect_income_completed.emit(result)
	else:
		result.error_code = "COLLECT_INCOME_FAILED"
		result.error_message = "collect_income_failed"
		collect_income_failed.emit(result)

	return result


func _income_collected(events: Array) -> bool:
	if events.is_empty():
		return false
	var first: GameEvent = events[0]
	return first.type == GameEvent.Type.INCOME_COLLECTED
