class_name PlacementEngine
extends RefCounted

var state: GameState
var _seq: int = 0

func _init(game_state: GameState, seq_start: int = 0) -> void:
	state = game_state
	_seq = seq_start

func process_placement(command: Command) -> Array:
	var placements: Array = command.payload.get("placements", [])
	var faction: String = command.player_id
	for p in placements:
		for u in p.units:
			_add_to_region(p.region_id, faction, u)
	state.pending_purchases[faction] = []
	return [
		GameEvent.create(
			GameEvent.Type.UNITS_PLACED,
			{"faction_id": faction, "placements": placements},
			_next_seq()
		)
	]

func check_forfeited(faction: String) -> Array:
	var pending: Array = state.pending_purchases.get(faction, [])
	if pending.is_empty():
		return []

	var valid: Array = state.factories_controlled_at_turn_start.get(faction, [])
	var current: Array = []

	for rid in state.regions:
		var r: Region = state.regions[rid]
		if r.has_factory and r.owner_faction_id == faction:
			current.append(rid)

	var lost: Array = []
	for f in valid:
		if f not in current:
			lost.append(f)

	if lost.size() > 0 and pending.size() > 0:
		var ipc := 0
		for p in pending:
			var ut: Unit = state.unit_types.get(p.unit_type_id)
			if ut:
				ipc += ut.cost * p.count

		state.pending_purchases[faction] = []

		return [
			GameEvent.create(
				GameEvent.Type.PLACEMENT_FORFEITED,
				{
					"faction_id": faction,
					"region_id": lost[0],
					"reason": "factory_lost",
					"forfeited_units": pending,
					"ipc_lost": ipc
				},
				_next_seq()
			)
		]

	return []

func _add_to_region(rid: String, faction: String, entry: Dictionary) -> void:
	if rid not in state.region_units:
		state.region_units[rid] = []

	var units: Array = state.region_units[rid]
	var ut: Unit = state.unit_types.get(entry.unit_type_id)

	# ⭐ SAFE CONTAINER CHECK (no method calls)
	var is_container := (
		ut != null
		and ut.container != null
		and ut.container is Dictionary
		and not ut.container.is_empty()
	)

	if is_container:
		for i in range(entry.count):
			var iid := state.generate_instance_id(entry.unit_type_id, faction)
			state.transport_instances[iid] = {
				"instance_id": iid,
				"unit_type_id": entry.unit_type_id,
				"cargo": [],
				"region_id": rid
			}
			units.append({
				"faction_id": faction,
				"unit_type_id": entry.unit_type_id,
				"instance_id": iid,
				"count": 1
			})
	else:
		for u in units:
			if u.faction_id == faction \
			and u.unit_type_id == entry.unit_type_id \
			and not u.has("instance_id"):
				u.count += entry.count
				return

		units.append({
			"faction_id": faction,
			"unit_type_id": entry.unit_type_id,
			"count": entry.count
		})

func _next_seq() -> int:
	_seq += 1
	return _seq

func set_sequence(val: int) -> void:
	_seq = val
