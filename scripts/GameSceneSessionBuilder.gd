extends RefCounted
class_name GameSceneSessionBuilder

const NEWMAP_PATH := "res://newmap.json"
const UNITS_PATH := "res://data/scenarios/minimal/units.json"
const RULES_PATH := "res://data/scenarios/minimal/rules.json"

const PLAYABLE_FACTIONS: Array[String] = ["allies", "axis"]
const FACTION_DISPLAY := {
	"Allies": "allies",
	"Axis": "axis",
}
const ADJACENCY_DISTANCE := 180.0


static func create_session_from_newmap() -> GameSession:
	var map_json: Dictionary = _load_json(NEWMAP_PATH)
	return GameSession.create(
		build_map_data(map_json),
		_load_json(UNITS_PATH),
		build_factions_data(),
		build_setup_data(map_json),
		_load_json(RULES_PATH),
		{"state": 12345, "sequence": 1}
	)


static func load_newmap() -> Dictionary:
	return _load_json(NEWMAP_PATH)


static func build_map_data(map_json: Dictionary) -> Dictionary:
	var regions: Array = []
	var centroids: Dictionary = {}
	var region_ids: Array[String] = []

	for region_entry in _extract_regions(map_json):
		var meta: Dictionary = region_entry.get("metadata", {})
		var region_id: String = str(meta.get("region_id", ""))
		if region_id.is_empty():
			continue

		var owner := _owner_from_metadata_faction(str(meta.get("faction", "")))
		if owner.is_empty() and region_id == "region_1":
			owner = "allies"

		regions.append({
			"id": region_id,
			"name": region_id,
			"type": "land",
			"ipc_value": int(meta.get("ipc", 0)),
			"owner_faction_id": owner,
			"is_capital": bool(meta.get("victory", false)),
			"has_factory": bool(meta.get("factory", false)) or owner in PLAYABLE_FACTIONS,
		})
		centroids[region_id] = _polygon_centroid(region_entry.get("polygon", []))
		region_ids.append(region_id)

	return {
		"schema_version": "0.5",
		"regions": regions,
		"adjacency": _build_adjacency(region_ids, centroids),
	}


static func build_factions_data() -> Dictionary:
	return {
		"schema_version": "0.5",
		"factions": [
			{
				"id": "allies",
				"name": "Allies",
				"color": "#3366CC",
				"starting_ipc": 30,
			},
			{
				"id": "axis",
				"name": "Axis",
				"color": "#CC3333",
				"starting_ipc": 30,
			},
		],
	}


static func build_setup_data(map_json: Dictionary) -> Dictionary:
	var starting_units: Array = []
	for region_entry in _extract_regions(map_json):
		var meta: Dictionary = region_entry.get("metadata", {})
		var region_id: String = str(meta.get("region_id", ""))
		var owner := _owner_from_metadata_faction(str(meta.get("faction", "")))
		if owner.is_empty() and region_id == "region_1":
			owner = "allies"
		if owner in PLAYABLE_FACTIONS:
			starting_units.append({
				"region_id": region_id,
				"faction_id": owner,
				"unit_type_id": "infantry",
				"count": 2,
			})

	if starting_units.is_empty():
		starting_units.append({
			"region_id": "region_1",
			"faction_id": "allies",
			"unit_type_id": "infantry",
			"count": 2,
		})

	return {
		"schema_version": "0.5",
		"turn_order": ["allies", "axis"],
		"starting_units": starting_units,
	}


static func display_name_for_faction_id(faction_id: String) -> String:
	match faction_id:
		"allies":
			return "Allies"
		"axis":
			return "Axis"
		_:
			return faction_id


static func faction_id_from_display(display_name: String) -> String:
	return str(FACTION_DISPLAY.get(display_name, display_name.to_lower()))


static func _extract_regions(map_json: Dictionary) -> Array:
	if map_json.has("regions") and typeof(map_json["regions"]) == TYPE_ARRAY:
		return map_json["regions"]
	return []


static func _owner_from_metadata_faction(faction_name: String) -> String:
	if faction_name.is_empty() or faction_name == "Neutral":
		return ""
	return faction_id_from_display(faction_name)


static func _polygon_centroid(polygon_points: Array) -> Vector2:
	if polygon_points.is_empty():
		return Vector2.ZERO
	var sum := Vector2.ZERO
	var count := 0
	for point in polygon_points:
		if typeof(point) == TYPE_ARRAY and point.size() >= 2:
			sum += Vector2(float(point[0]), float(point[1]))
			count += 1
	if count == 0:
		return Vector2.ZERO
	return sum / float(count)


static func _build_adjacency(
	region_ids: Array[String],
	centroids: Dictionary
) -> Array:
	var edges: Array = []
	var seen: Dictionary = {}
	for i in range(region_ids.size()):
		for j in range(i + 1, region_ids.size()):
			var from_id: String = region_ids[i]
			var to_id: String = region_ids[j]
			var a: Vector2 = centroids.get(from_id, Vector2.ZERO)
			var b: Vector2 = centroids.get(to_id, Vector2.ZERO)
			if a.distance_to(b) > ADJACENCY_DISTANCE:
				continue
			var key := "%s|%s" % [from_id, to_id]
			if seen.has(key):
				continue
			seen[key] = true
			edges.append({"from": from_id, "to": to_id})
	return edges


static func _load_json(path: String) -> Dictionary:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		push_error("GameSceneSessionBuilder: failed to open %s" % path)
		return {}
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	file.close()
	if typeof(parsed) != TYPE_DICTIONARY:
		push_error("GameSceneSessionBuilder: invalid JSON in %s" % path)
		return {}
	return parsed as Dictionary
