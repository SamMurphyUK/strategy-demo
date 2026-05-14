class_name EconomyEngine
extends RefCounted

var state: GameState
var _seq: int = 0

func _init(p_state: GameState = null) -> void:
	state = p_state

func set_sequence(seq: int) -> void:
	_seq = seq

func _next_seq() -> int:
	_seq += 1
	return _seq

func calculate_income(faction_id: String) -> int:
	var total_ipc := 0
	for region_id in state.regions.keys():
		var region: Region = state.regions[region_id]
		if region.owner_faction_id == faction_id and region.is_land_region():
			total_ipc += region.ipc_value
	return total_ipc

func collect_income(faction_id: String) -> Array:
	var income := calculate_income(faction_id)
	state.ipc[faction_id] = state.ipc.get(faction_id, 0) + income
	return [GameEvent.create(
		GameEvent.Type.INCOME_COLLECTED,
		{"faction_id": faction_id, "amount": income, "new_total": state.ipc[faction_id]},
		_next_seq()
	)]

func process_purchase(cmd: Command) -> Array:
	var events: Array = []
	var faction_id: String = cmd.player_id

	# ⭐ DEBUG: RAW PAYLOAD
	print("\n=== DEBUG PURCHASE START ===")
	print("RAW PAYLOAD: ", cmd.payload)

	# Support both shapes: "purchases" and "units"
	var purchases: Array = cmd.payload.get("purchases", [])
	if purchases.is_empty():
		purchases = cmd.payload.get("units", [])

	print("PURCHASE ARRAY: ", purchases)
	print("UNIT TYPES KEYS: ", state.unit_types.keys())

	var total_cost := 0

	for purchase in purchases:
		print("SINGLE PURCHASE ENTRY: ", purchase)

		var unit_type_id := String(purchase.get("unit_type_id", ""))
		var count := int(purchase.get("count", 1))

		print("LOOKUP ID: ", unit_type_id)

		var u: Unit = state.unit_types.get(unit_type_id)
		print("LOOKUP RESULT: ", u)

		if u:
			total_cost += u.cost * count

	print("CALCULATED COST: ", total_cost)
	print("IPC BEFORE: ", state.ipc.get(faction_id, 0))

	if total_cost > state.ipc.get(faction_id, 0):
		print("PURCHASE FAILED: insufficient IPC")
		print("=== DEBUG PURCHASE END ===\n")
		return [GameEvent.create(
			GameEvent.Type.PURCHASE_FAILED,
			{"faction_id": faction_id, "reason": "insufficient_ipc"},
			_next_seq()
		)]

	state.ipc[faction_id] -= total_cost
	state.pending_purchases[faction_id] = purchases

	print("IPC AFTER: ", state.ipc.get(faction_id, 0))
	print("=== DEBUG PURCHASE END ===\n")

	events.append(GameEvent.create(
		GameEvent.Type.UNITS_PURCHASED,
		{"faction_id": faction_id, "units": purchases, "cost": total_cost},
		_next_seq()
	))

	return events

func can_afford(faction_id: String, unit_type_id: String, count: int = 1) -> bool:
	var u: Unit = state.unit_types.get(unit_type_id)
	if u == null:
		return false
	return state.ipc.get(faction_id, 0) >= u.cost * count
