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
var special: Dictionary = {}


static func from_dict(data: Dictionary) -> Unit:
	var unit := Unit.new()
	unit.id = String(data.get("id", ""))
	unit.name = data.get("name", "")
	unit.category = data.get("category", "")
	unit.attack = int(data.get("attack", 0))
	unit.defense = int(data.get("defense", 0))
	unit.movement = int(data.get("movement", data.get("move", 0)))
	unit.cost = int(data.get("cost", 0))
	unit.container = data.get("container", {}) if data.get("container") is Dictionary else {}
	unit.special = data.get("special", {}) if data.get("special") is Dictionary else {}
	return unit


static func is_container_unit(unit: Unit) -> bool:
	return unit != null and unit.container is Dictionary and not unit.container.is_empty()
