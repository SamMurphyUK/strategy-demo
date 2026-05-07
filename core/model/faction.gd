class_name Faction
extends RefCounted

var id: String
var name: String
var color: String
var starting_ipc: int

static func from_dict(data: Dictionary) -> Faction:
	var faction := Faction.new()
	faction.id = data.get("id", "")
	faction.name = data.get("name", "")
	faction.color = data.get("color", "#FFFFFF")
	faction.starting_ipc = data.get("starting_ipc", 0)
	return faction