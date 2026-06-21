class_name MovementEngine
extends RefCounted

var state: GameState
var _seq: int = 0

func _init(game_state: GameState, seq_start: int = 0) -> void:
	state = game_state
	_seq = seq_start

func process_move(command: Command) -> Array:
	var moves: Array = command.payload.get("moves", [])
	for move in moves:
		for unit_entry in move.units:
			_transfer(move.from_region_id, move.to_region_id, command.player_id, unit_entry)
	return [GameEvent.create(GameEvent.Type.UNITS_MOVED, {"faction_id": command.player_id, "moves": moves}, _next_seq())]

func process_load(command: Command) -> Array:
	var tid: String = command.payload.transport_instance_id
	var from_region: String = command.payload.from_region_id
	var units: Array = command.payload.units
	var td: Dictionary = state.transport_instances[tid]
	for u in units:
		_remove_from_region(from_region, command.player_id, u)
		_add_to_cargo(tid, u)
	return [GameEvent.create(GameEvent.Type.TRANSPORT_LOADED, {"faction_id": command.player_id, "transport_instance_id": tid, "sea_zone_id": td.region_id, "from_region_id": from_region, "units": units}, _next_seq())]

func process_unload(command: Command) -> Array:
	var tid: String = command.payload.transport_instance_id
	var to_region: String = command.payload.to_region_id
	var units: Array = command.payload.units
	var td: Dictionary = state.transport_instances[tid]
	for u in units:
		_remove_from_cargo(tid, u)
		_add_to_region(to_region, command.player_id, u)
	return [GameEvent.create(GameEvent.Type.TRANSPORT_UNLOADED, {"faction_id": command.player_id, "transport_instance_id": tid, "sea_zone_id": td.region_id, "to_region_id": to_region, "units": units}, _next_seq())]

func _transfer(from: String, to: String, faction: String, entry: Dictionary) -> void:
	_remove_from_region(from, faction, entry)
	_add_to_region(to, faction, entry)
	if entry.has("instance_id"):
		state.record_instance_moved(str(entry.get("instance_id", "")))
	else:
		state.record_stack_arrival(
			faction,
			to,
			str(entry.get("unit_type_id", "")),
			int(entry.get("count", 1))
		)

func _remove_from_region(rid: String, faction: String, entry: Dictionary) -> void:
	var units: Array = state.region_units.get(rid, [])
	var count: int = entry.count
	for i in range(units.size() - 1, -1, -1):
		var u: Dictionary = units[i]
		if u.faction_id == faction and u.unit_type_id == entry.unit_type_id and not u.has("instance_id"):
			if u.count > count: u.count -= count; break
			else: count -= u.count; units.remove_at(i)
			if count <= 0: break

func _add_to_region(rid: String, faction: String, entry: Dictionary) -> void:
	if rid not in state.region_units: state.region_units[rid] = []
	var units: Array = state.region_units[rid]
	for u in units:
		if u.faction_id == faction and u.unit_type_id == entry.unit_type_id and not u.has("instance_id"):
			u.count += entry.count; return
	units.append({"faction_id": faction, "unit_type_id": entry.unit_type_id, "count": entry.count})

func _add_to_cargo(tid: String, entry: Dictionary) -> void:
	var cargo: Array = state.transport_instances[tid].cargo
	for c in cargo:
		if c.unit_type_id == entry.unit_type_id: c.count += entry.count; return
	cargo.append({"unit_type_id": entry.unit_type_id, "count": entry.count})

func _remove_from_cargo(tid: String, entry: Dictionary) -> void:
	var cargo: Array = state.transport_instances[tid].cargo
	var count: int = entry.count
	for i in range(cargo.size() - 1, -1, -1):
		var c: Dictionary = cargo[i]
		if c.unit_type_id == entry.unit_type_id:
			if c.count > count: c.count -= count; break
			else: count -= c.count; cargo.remove_at(i)
			if count <= 0: break

func _next_seq() -> int:
	_seq += 1
	return _seq

func set_sequence(val: int) -> void:
	_seq = val
