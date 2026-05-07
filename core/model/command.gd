class_name Command
extends RefCounted

enum Type { PURCHASE_UNITS, MOVE_UNITS, LOAD_TRANSPORT, UNLOAD_TRANSPORT, DESIGNATE_AMPHIBIOUS, PLACE_UNITS, END_PHASE, END_TURN }

var command_id: String
var player_id: String
var type: Type
var payload: Dictionary

static func from_dict(data: Dictionary) -> Command:
	var cmd := Command.new()
	cmd.command_id = data.get("command_id", "")
	cmd.player_id = data.get("player_id", "")
	cmd.type = _parse_type(data.get("type", ""))
	cmd.payload = data.get("payload", {})
	return cmd

static func _parse_type(type_string: String) -> Type:
	match type_string:
		"purchase_units": return Type.PURCHASE_UNITS
		"move_units": return Type.MOVE_UNITS
		"load_transport": return Type.LOAD_TRANSPORT
		"unload_transport": return Type.UNLOAD_TRANSPORT
		"designate_amphibious": return Type.DESIGNATE_AMPHIBIOUS
		"place_units": return Type.PLACE_UNITS
		"end_phase": return Type.END_PHASE
		"end_turn": return Type.END_TURN
		_: return Type.END_PHASE