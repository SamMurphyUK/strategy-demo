extends Node2D
class_name GameMapRoot

signal region_selected(region_id: String)

@export var map_json_path: String = "res://demomap01.json"
@export var region_layer: Node2D

var regions = {}
var selected_region_id = ""

var faction_colors = {
	"Allies": Color(0.2, 0.4, 0.8, 0.4),
	"Axis": Color(0.8, 0.2, 0.2, 0.4),
	"Independent": Color(0.2, 0.7, 0.2, 0.4),
	"Neutral": Color(0.5, 0.5, 0.5, 0.4),
	"": Color(1.0, 0.0, 0.0, 0.4),
}

var highlight_color := Color(1, 1, 0, 0.8)

func _ready() -> void:
	_autobind()
	load_map_from_json(map_json_path)
	set_process_unhandled_input(true)

func _autobind() -> void:
	if region_layer == null:
		region_layer = get_node_or_null("RegionLayer")
		if region_layer == null:
			region_layer = Node2D.new()
			region_layer.name = "RegionLayer"
			add_child(region_layer)

func load_map_from_json(path: String) -> void:
	_clear_regions()
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		push_error("GameMapRoot: Could not open map JSON: " + path)
		return
	var parsed = JSON.parse_string(file.get_as_text())
	if typeof(parsed) != TYPE_DICTIONARY:
		push_error("GameMapRoot: JSON parse error in " + path)
		return
	var data: Dictionary = parsed
	if data.has("faction_colors"):
		_load_faction_colors(data["faction_colors"])
	_build_regions(data)

func _build_regions(data: Dictionary) -> void:
	for region_dict in data.get("regions", []):
		if typeof(region_dict) != TYPE_DICTIONARY:
			continue
		var meta: Dictionary = region_dict.get("metadata", {})
		var region_id = str(meta.get("region_id", ""))
		if region_id == "":
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
	var points := PackedVector2Array()
	for p in points_raw:
		if typeof(p) == TYPE_ARRAY and p.size() >= 2:
			points.append(Vector2(p[0], p[1]))
	var poly := Polygon2D.new()
	poly.name = "Polygon2D"
	poly.polygon = points
	poly.color = _owner_color(faction)
	region.add_child(poly)
	var outline := Line2D.new()
	outline.name = "Outline"
	outline.width = 4
	outline.default_color = highlight_color
	outline.visible = false
	for pt in points:
		outline.add_point(pt)
	if points.size() > 0:
		outline.add_point(points[0])
	region.add_child(outline)
	var meta := RegionMetadata.new()
	meta.name = "RegionMetadata"
	meta.region_id = region_id
	meta.faction = faction
	meta.ipc_value = ipc
	region.add_child(meta)
	var area := Area2D.new()
	area.input_pickable = true
	var col := CollisionPolygon2D.new()
	col.polygon = points
	area.add_child(col)
	area.input_event.connect(_on_region_input_event.bind(region_id))
	region.add_child(area)
	return region

func _on_region_input_event(viewport: Node, event: InputEvent, shape_idx: int, region_id: String) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		select_region(region_id)

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var region_id := _find_region_at_point(event.position)
		if region_id != "":
			select_region(region_id)

func select_region(region_id: String) -> void:
	if selected_region_id != "" and regions.has(selected_region_id):
		var old_outline = regions[selected_region_id].get_node_or_null("Outline")
		if old_outline:
			old_outline.visible = false
	selected_region_id = region_id
	var outline = regions[region_id].get_node_or_null("Outline")
	if outline:
		outline.visible = true
	emit_signal("region_selected", region_id)

func _find_region_at_point(global_pos: Vector2) -> String:
	for region_id in regions.keys():
		var region := regions[region_id]
		var poly := region.get_node_or_null("Polygon2D")
		if poly == null:
			continue
		var local_pos := region.to_local(global_pos)
		if Geometry2D.is_point_in_polygon(local_pos, poly.polygon):
			return region_id
	return ""

func get_selected_region_id() -> String:
	return selected_region_id

func update_from_snapshot(snapshot: Dictionary) -> void:
	for r_state in snapshot.get("regions", []):
		if typeof(r_state) != TYPE_DICTIONARY:
			continue
		var region_id = str(r_state.get("region_id", ""))
		var owner = str(r_state.get("owner_faction_id", ""))
		var region = regions.get(region_id, null)
		if region == null:
			continue
		var poly = region.get_node_or_null("Polygon2D")
		if poly:
			poly.color = _owner_color(owner)
		var meta = region.get_node_or_null("RegionMetadata")
		if meta:
			meta.faction = owner

func update_region_colors(snapshot: Dictionary) -> void:
	for region_entry in snapshot.get("regions", []):
		if typeof(region_entry) != TYPE_DICTIONARY:
			continue
		var region_id := str(region_entry.get("region_id", ""))
		var owner := str(region_entry.get("owner_faction_id", "neutral")).to_lower()
		var region_node: Node2D = get_node_or_null("RegionLayer/%s" % region_id)
		if region_node == null:
			continue
		var color := Color(0.8, 0.8, 0.8)
		match owner:
			"allies":
				color = Color(0.0, 0.6, 0.0)
			"axis":
				color = Color(0.6, 0.0, 0.0)
			_:
				color = Color(0.8, 0.8, 0.8)
		region_node.modulate = color
		var poly := region_node.get_node_or_null("Polygon2D")
		if poly and poly is CanvasItem:
			poly.self_modulate = Color(1, 1, 1, 0.9)

func _region_id_at_position(global_pos: Vector2) -> String:
	return _find_region_at_point(global_pos)

func _can_drop_at_region(region_id: String, drag_data: Dictionary) -> bool:
	return not region_id.is_empty() and not str(drag_data.get("unit_type_id", "")).is_empty()

func drop_staged_unit(
	global_pos: Vector2,
	drag_data: Dictionary,
	session,
	command_id: String,
	player_id: String
) -> Dictionary:
	var region_id := _region_id_at_position(global_pos)
	if not _can_drop_at_region(region_id, drag_data):
		return {"result_type": "error", "error": {"code": "DROP_INVALID", "message": "Invalid drop target"}, "events": []}
	return session.apply_command({
		"command_id": command_id,
		"player_id": player_id,
		"type": "place_units",
		"payload": {
			"placements": [{
				"region_id": region_id,
				"units": [{
					"unit_type_id": str(drag_data.get("unit_type_id", "")),
					"count": int(drag_data.get("count", 1)),
				}],
			}],
		},
	})

func show_region_stack(region_id: String, session_snapshot: Dictionary, stack_container: VBoxContainer) -> void:
	if stack_container == null:
		return
	for child in stack_container.get_children():
		child.queue_free()
	for region_entry in session_snapshot.get("regions", []):
		if str(region_entry.get("region_id", "")) != region_id:
			continue
		var by_faction := {}
		for u in region_entry.get("units", []):
			var faction := str(u.get("faction_id", "neutral")).to_lower()
			if not by_faction.has(faction):
				by_faction[faction] = {}
			var unit_type := str(u.get("unit_type_id", ""))
			by_faction[faction][unit_type] = int(by_faction[faction].get(unit_type, 0)) + int(u.get("count", 0))
		for faction in by_faction.keys():
			for unit_type in by_faction[faction].keys():
				var row := Label.new()
				row.text = "%s: %s x%d" % [faction.capitalize(), unit_type, int(by_faction[faction][unit_type])]
				stack_container.add_child(row)
		return

func _owner_color(faction_name: String) -> Color:
	return faction_colors.get(faction_name, faction_colors[""])

func _load_faction_colors(raw_colors: Dictionary) -> void:
	for faction_name in raw_colors.keys():
		var arr = raw_colors[faction_name]
		if typeof(arr) == TYPE_ARRAY and arr.size() >= 4:
			faction_colors[faction_name] = Color(float(arr[0]), float(arr[1]), float(arr[2]), float(arr[3]))

func _clear_regions() -> void:
	for child in region_layer.get_children():
		child.queue_free()
	regions.clear()
