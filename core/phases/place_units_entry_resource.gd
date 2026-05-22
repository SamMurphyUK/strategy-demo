extends Resource
class_name PlaceUnitsEntryResource

@export var region_id: String = ""
@export var unit_lines: Array[PlaceUnitsUnitLineResource] = []


static func from_dict(data: Dictionary) -> PlaceUnitsEntryResource:
	var entry := PlaceUnitsEntryResource.new()
	entry.region_id = str(data.get("region_id", ""))
	var raw_units: Array = data.get("units", [])
	for unit_data in raw_units:
		if typeof(unit_data) != TYPE_DICTIONARY:
			continue
		entry.unit_lines.append(PlaceUnitsUnitLineResource.from_dict(unit_data))
	return entry


func to_dict() -> Dictionary:
	var units: Array = []
	for line in unit_lines:
		units.append(line.to_dict())
	return {"region_id": region_id, "units": units}
