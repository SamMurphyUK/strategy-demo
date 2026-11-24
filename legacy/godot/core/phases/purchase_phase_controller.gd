class_name PurchasePhaseController
extends Object

signal purchase_completed(result: PurchasePhaseResultResource)
signal purchase_failed(result: PurchasePhaseResultResource)


func process_purchase(
	batch: PurchaseBatchResource,
	economy: EconomyEngine,
	cmd: Command
) -> PurchasePhaseResultResource:
	var result := PurchasePhaseResultResource.new()
	var events: Array = economy.process_purchase(cmd)
	result.game_events = events
	result.success = _purchase_succeeded(events)

	if result.success:
		purchase_completed.emit(result)
	else:
		result.error_code = "PURCHASE_FAILED"
		result.error_message = _failure_reason(events)
		purchase_failed.emit(result)

	return result


func _purchase_succeeded(events: Array) -> bool:
	if events.is_empty():
		return false
	var first: GameEvent = events[0]
	return first.type == GameEvent.Type.UNITS_PURCHASED


func _failure_reason(events: Array) -> String:
	if events.is_empty():
		return "no_events"
	var first: GameEvent = events[0]
	if first.type == GameEvent.Type.PURCHASE_FAILED:
		return str(first.payload.get("reason", "purchase_failed"))
	return "purchase_failed"
