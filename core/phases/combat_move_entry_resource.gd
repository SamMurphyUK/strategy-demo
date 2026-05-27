extends Resource
class_name CombatMoveEntryResource

@export var from_region_id: String = ""
@export var to_region_id: String = ""
@export var unit_lines: Array[CombatMoveUnitLineResource] = []


static func from_dict(data: Dictionary) -> CombatMoveEntryResource:
	var entry := CombatMoveEntryResource.new()
	entry.from_region_id = str(data.get("from_region_id", ""))
	entry.to_region_id = str(data.get("to_region_id", ""))
	var raw_units: Array = data.get("units", [])
	for unit_data in raw_units:
		if typeof(unit_data) != TYPE_DICTIONARY:
			continue
		entry.unit_lines.append(CombatMoveUnitLineResource.from_dict(unit_data))
	return entry


func to_dict() -> Dictionary:
	var units: Array = []
	for line in unit_lines:
		units.append(line.to_dict())
	return {
		"from_region_id": from_region_id,
		"to_region_id": to_region_id,
		"units": units,
	}
