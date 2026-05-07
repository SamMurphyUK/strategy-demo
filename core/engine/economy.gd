class_name EconomyEngine
extends RefCounted

var state: GameState
var _seq: int = 0

func _init(game_state: GameState, seq_start: int = 0) -> void:
	state = game_state
	_seq = seq_start

func process_purchase(command: Command) -> Array:
	var purchases: Array = command.payload.get("purchases", [])
	var total := 0
	for p in purchases:
		var unit: Unit = state.unit_types[p.unit_type_id]
		total += unit.cost * p.count
	state.modify_ipc(command.player_id, -total)
	state.pending_purchases[command.player_id] = purchases.duplicate(true)
	return [GameEvent.create(GameEvent.Type.UNITS_PURCHASED, {"faction_id": command.player_id, "purchases": purchases, "ipc_spent": total, "ipc_remaining": state.get_faction_ipc(command.player_id)}, _next_seq())]

func collect_income(faction_id: String) -> Array:
	var income := 0
	for rid in state.regions:
		var r: Region = state.regions[rid]
		if r.owner_faction_id == faction_id and r.is_land(): income += r.ipc_value
	state.modify_ipc(faction_id, income)
	return [GameEvent.create(GameEvent.Type.INCOME_COLLECTED, {"faction_id": faction_id, "amount": income, "new_total": state.get_faction_ipc(faction_id)}, _next_seq())]

func _next_seq() -> int:
	_seq += 1
	return _seq

func set_sequence(val: int) -> void:
	_seq = val