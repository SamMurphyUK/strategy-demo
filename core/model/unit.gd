class_name Unit
extends RefCounted

# Instance identifier (numeric, used everywhere in your tests + builder)
var id: int

# Static unit type data (comes from ruleset)
var name: String
var category: String
var attack: int
var defense: int
var movement: int
var cost: int

# Optional container metadata (transports, carriers, etc.)
var container: Dictionary = {}

static func from_dict(data: Dictionary) -> Unit:
	var unit := Unit.new()
	unit.id = int(data.get("id", 0))
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
