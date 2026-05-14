extends RefCounted
class_name PurchaseValidator

const VT := preload("res://core/validation/validation_types.gd")

func validate_purchase_batch(batch: Dictionary, state: GameState, ruleset: Ruleset) -> VT.ValidationResult:
	var result := VT.ValidationResult.new()
	var total_cost: int = 0

	var items: Array = batch.get("items", [])

	for item in items:
		var unit_type: String = item.get("unit_type", "")
		var count: int = item.get("count", 0)

		var def := ruleset.get_unit_def(unit_type)
		if def.is_empty():
			var err := VT.MoveError.new()
			err.code = "UNKNOWN_UNIT"
			err.message = "Unknown unit type: %s" % unit_type
			result.errors.append(err)
			continue

		total_cost += def.get("cost", 0) * count

	# FIX: IPC is stored per faction, not globally
	var faction_id := state.current_faction_id
	var available_ipc: int = state.ipc.get(faction_id, 0)

	if total_cost > available_ipc:
		var err := VT.MoveError.new()
		err.code = "INSUFFICIENT_IPC"
		err.message = "Purchase exceeds available IPC."
		result.errors.append(err)

	result.ok = result.errors.is_empty()
	return result
