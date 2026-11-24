class_name Faction
extends RefCounted

var id: String = ""
var name: String = ""
var color: String = "#FFFFFF"
var starting_ipc: int = 0
var turn_order: int = 0   # <-- REQUIRED so ContentLoader can read it


static func from_dict(data: Dictionary) -> Faction:
	var faction := Faction.new()

	faction.id = data.get("id", "")
	faction.name = data.get("name", "")
	faction.color = data.get("color", "#FFFFFF")
	faction.starting_ipc = int(data.get("starting_ipc", 0))

	# NEW: safely load turn_order (default 0 if missing)
	faction.turn_order = int(data.get("turn_order", 0))

	return faction
