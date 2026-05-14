class_name Command
extends RefCounted

enum Type {
	PURCHASE_UNITS,
	MOVE_UNITS,
	LOAD_TRANSPORT,
	UNLOAD_TRANSPORT,
	DESIGNATE_AMPHIBIOUS,
	PLACE_UNITS,
	END_PHASE,
	END_TURN
}

var command_id: String
var player_id: String
var type: Type
var payload: Dictionary

static func from_dict(data: Dictionary) -> Command:
	var cmd := Command.new()
	cmd.command_id = data.get("command_id", "")
	cmd.player_id = data.get("player_id", "")

	# ⭐ DEBUG: show raw type and parsed result
	var raw_type = data.get("type", "")
	print("DEBUG CMD TYPE RAW: ", raw_type)

	cmd.type = _parse_type(raw_type)
	print("DEBUG CMD TYPE PARSED: ", cmd.type)

	cmd.payload = data.get("payload", {})
	return cmd


static func _parse_type(type_string) -> Type:
	# ⭐ CRITICAL FIX:
	# String(type_string) forces conversion from Variant/StringName → String
	var t := String(type_string).strip_edges().to_lower()

	match t:
		"purchase_units": return Type.PURCHASE_UNITS
		"move_units": return Type.MOVE_UNITS
		"load_transport": return Type.LOAD_TRANSPORT
		"unload_transport": return Type.UNLOAD_TRANSPORT
		"designate_amphibious": return Type.DESIGNATE_AMPHIBIOUS
		"place_units": return Type.PLACE_UNITS
		"end_phase": return Type.END_PHASE
		"end_turn": return Type.END_TURN

		# ⭐ Safe fallback
		_: 
			print("DEBUG WARNING: Unknown command type: ", t)
			return Type.END_PHASE
