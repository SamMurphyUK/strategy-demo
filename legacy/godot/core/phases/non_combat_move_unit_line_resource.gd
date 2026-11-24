extends Resource
class_name NonCombatMoveUnitLineResource

@export var unit_type_id: String = ""
@export var count: int = 1


static func from_dict(data: Dictionary) -> NonCombatMoveUnitLineResource:
	var line := NonCombatMoveUnitLineResource.new()
	line.unit_type_id = str(data.get("unit_type_id", ""))
	line.count = int(data.get("count", 1))
	return line


func to_dict() -> Dictionary:
	return {"unit_type_id": unit_type_id, "count": count}
