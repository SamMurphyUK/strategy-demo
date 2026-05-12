extends Resource
class_name UnitDatabase

var units: Dictionary = {}  # id -> Dictionary


func load_from_json(path: String) -> void:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		push_error("UnitDatabase: Failed to open units file: %s" % path)
		return

	var text: String = file.get_as_text()
	file.close()

	var data: Variant = JSON.parse_string(text)
	if typeof(data) != TYPE_DICTIONARY or not data.has("units"):
		push_error("UnitDatabase: Invalid units.json structure")
		return

	units.clear()

	for unit_def: Dictionary in data["units"]:
		if not unit_def.has("id"):
			continue

		var id: String = str(unit_def["id"])
		units[id] = unit_def
