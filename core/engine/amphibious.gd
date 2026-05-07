class_name AmphibiousEngine
extends RefCounted

var state: GameState
var _seq: int = 0

func _init(game_state: GameState, seq_start: int = 0) -> void:
	state = game_state
	_seq = seq_start

func designate_assault(command: Command) -> Array:
	var tid: String = command.payload.transport_instance_id
	var origin: String = command.payload.origin_sea_zone_id
	var target: String = command.payload.target_region_id
	var td: Dictionary = state.transport_instances[tid]
	var cargo: Array = td.cargo.duplicate(true)
	var aid := "amp_%03d" % (state.pending_amphibious_assaults.size() + 1)
	state.pending_amphibious_assaults.append({"assault_id": aid, "transport_instance_id": tid, "origin_sea_zone_id": origin, "target_region_id": target, "cargo": cargo})
	return [GameEvent.create(GameEvent.Type.AMPHIBIOUS_DECLARED, {"assault_id": aid, "faction_id": command.player_id, "transport_instance_id": tid, "origin_sea_zone_id": origin, "target_region_id": target, "cargo": cargo}, _next_seq())]

func resolve_assaults(attacker: String, combat: CombatEngine) -> Array:
	var events: Array = []
	# Simplified - clear pending assaults
	state.pending_amphibious_assaults = []
	return events

func _next_seq() -> int:
	_seq += 1
	return _seq

func set_sequence(val: int) -> void:
	_seq = val
