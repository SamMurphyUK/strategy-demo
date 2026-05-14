class_name Unit
extends RefCounted

var id: String
var name: String
var category: String
var attack: int
var defense: int
var movement: int
var cost: int
var container: Dictionary = {}

static func from_dict(data: Dictionary) -> Unit:
	var unit := Unit.new()
	unit.id = String(data.get("id", ""))
	unit.name = data.get("name", "")
	unit.category = data.get("category", "")
	unit.attack = int(data.get("attack", 0))
	unit.defense = int(data.get("defense", 0))
	unit.movement = int(data.get("movement", 0))
	unit.cost = int(data.get("cost", 0))
	unit.container = data.get("container", {}) if data.get("container") != null else {}
	return unit
