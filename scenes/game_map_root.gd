extends Node2D
class_name GameMapRoot

signal region_selected(region_id: String)

@export var map_json_path: String = "res://newmap.json"
@export var region_layer: Node2D

var regions = {}              # region_id -> region_node
var selected_region_id = ""   # last clicked region

var faction_colors = {
	"Allies": Color(0.2, 0.4, 0.8, 0.4),
	"Axis": Color(0.8, 0.2, 0.2, 0.4),
	"Independent": Color(0.2, 0.7, 0.2, 0.4),
	"Neutral": Color(0.5, 0.5, 0.5, 0.4),
	"": Color(1.0, 0.0, 0.0, 0.4),
}


func _ready() -> void:
	_autobind()
	load_map_from_json(map_json_path)


# ---------------------------------------------------------
# AUTO-BIND
# ---------------------------------------------------------
func _autobind() -> void:
	if region_layer == null:
		region_layer = get_node_or_null("RegionLayer")
		if region_layer == null:
			region_layer = Node2D.new()
			region_layer.name = "RegionLayer"
			add_child(region_layer)


# ---------------------------------------------------------
# LOAD MAP
# ---------------------------------------------------------
func load_map_from_json(path: String) -> void:
	_clear_regions()

	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		push_error("GameMapRoot: Could not open map JSON: " + path)
		return

	var text := file.get_as_text()
	var parsed = JSON.parse_string(text)
	if parsed == null:
		push_error("GameMapRoot: JSON parse error in " + path)
		return

	var data: Dictionary = parsed

	# Optional: load faction colors from JSON
	if data.has("faction_colors"):
		_load_faction_colors(data["faction_colors"])

	_build_regions(data)


# ---------------------------------------------------------
# BUILD REGIONS
# ---------------------------------------------------------
func _build_regions(data: Dictionary) -> void:
	for region_dict in data.get("regions", []):
		if typeof(region_dict) != TYPE_DICTIONARY:
			continue

		var meta: Dictionary = region_dict.get("metadata", {})
		var region_id = str(meta.get("region_id", ""))

		# Skip invalid regions
		if region_id == "":
			push_warning("GameMapRoot: Region with missing ID skipped.")
			continue

		var faction = str(meta.get("faction", ""))
		var ipc = int(meta.get("ipc", 0))
		var points_raw = region_dict.get("polygon", [])

		var region_node = _create_region(region_id, points_raw, faction, ipc)
		region_layer.add_child(region_node)
		regions[region_id] = region_node


func _create_region(region_id: String, points_raw: Array, faction: String, ipc: int) -> Node2D:
	var region := Node2D.new()
	region.name = region_id

	# Convert points
	var points := PackedVector2Array()
	for p in points_raw:
		if typeof(p) == TYPE_ARRAY and p.size() >= 2:
			points.append(Vector2(p[0], p[1]))

	# Polygon (visual)
	var poly := Polygon2D.new()
	poly.name = "Polygon2D"
	poly.polygon = points
	poly.color = _owner_color(faction)
	region.add_child(poly)

	# Metadata
	var meta := RegionMetadata.new()
	meta.name = "RegionMetadata"
	meta.region_id = region_id
	meta.faction = faction
	meta.ipc_value = ipc
	region.add_child(meta)

	# Click detection
	var area := Area2D.new()
	area.input_pickable = true

	var col := CollisionPolygon2D.new()
	col.polygon = points
	col.disabled = false
	area.add_child(col)

	# Godot 4: (area, event, shape_idx)
	area.input_event.connect(_on_region_input_event.bind(region_id))
	region.add_child(area)

	return region


# ---------------------------------------------------------
# REGION CLICK HANDLING
# ---------------------------------------------------------
func _on_region_input_event(area: Area2D, event: InputEvent, shape_idx: int, region_id: String) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		selected_region_id = region_id
		emit_signal("region_selected", region_id)


func get_selected_region_id() -> String:
	return selected_region_id


# ---------------------------------------------------------
# SNAPSHOT UPDATE
# ---------------------------------------------------------
func update_from_snapshot(snapshot: Dictionary) -> void:
	for r_state in snapshot.get("regions", []):
		if typeof(r_state) != TYPE_DICTIONARY:
			continue

		var region_id = str(r_state.get("region_id", ""))
		var owner = str(r_state.get("owner", ""))

		var region = regions.get(region_id, null)
		if region == null:
			continue

		var poly = region.get_node_or_null("Polygon2D")
		if poly:
			poly.color = _owner_color(owner)

		var meta = region.get_node_or_null("RegionMetadata")
		if meta:
			meta.faction = owner


# ---------------------------------------------------------
# HELPERS
# ---------------------------------------------------------
func _owner_color(faction_name: String) -> Color:
	return faction_colors.get(faction_name, faction_colors[""])


func _load_faction_colors(raw_colors: Dictionary) -> void:
	for faction_name in raw_colors.keys():
		var arr = raw_colors[faction_name]
		if typeof(arr) == TYPE_ARRAY and arr.size() >= 4:
			faction_colors[faction_name] = Color(
				float(arr[0]),
				float(arr[1]),
				float(arr[2]),
				float(arr[3])
			)


func _clear_regions() -> void:
	for child in region_layer.get_children():
		child.queue_free()
	regions.clear()
