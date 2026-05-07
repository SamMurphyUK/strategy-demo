class_name Unit
extends RefCounted

var id: String
var name: String
var category: String
var attack: int
var defense: int
var movement: int
var cost: int
var container: Dictionary

static func from_dict(data: Dictionary) -> Unit:
	var unit := Unit.new()
	unit.id = data.get("id", "")
	unit.name = data.get("name", "")
	unit.category = data.get("category", "")
	unit.attack = data.get("attack", 0)
	unit.defense = data.get("defense", 0)
	unit.movement = data.get("movement", 0)
	unit.cost = data.get("cost", 0)
	unit.container = data.get("container", {}) if data.get("container") != null else {}
	return unit

func is_container() -> bool:
	return not container.is_empty()

func get_capacity() -> int:
	return container.get("capacity", 0) if is_container() else 0