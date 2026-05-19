extends Node2D
class_name MapEditor

# -------------------------
# Core scene nodes (must exist)
# -------------------------
@onready var map_root: Node2D = $MapRoot
@onready var base_map: Sprite2D = $MapRoot/BaseMap
@onready var region_layer: Node2D = $MapRoot/RegionLayer

# UI nodes (Inspector is expected; others optional)
@onready var inspector: Node = $ToolLayer/UI/InspectorPanel
@onready var region_list: ItemList = $ToolLayer/UI/RegionList
@onready var ui_root: Node = $ToolLayer/UI

# Optional UI nodes (looked up in _ready)
var load_regions_button: Button = null
# CanvasLayer to hold IPC labels (created if missing)
var ipc_canvas: CanvasLayer = null

# Editor state
var current_region: Node2D = null
var drawing_points: Array = []
var is_drawing: bool = false

var preview_poly: Line2D = null
var pan_speed: float = 500.0


# -------------------------
# Utility helpers
# -------------------------
func _has_property_by_name(node: Object, prop_name: String) -> bool:
	if node == null:
		return false
	var plist := node.get_property_list()
	for p in plist:
		if typeof(p) == TYPE_DICTIONARY and p.get("name", "") == prop_name:
			return true
	return false


func _set_control_position(control: Object, pos: Vector2) -> void:
	# Set position on a Control in a safe, cross-build way.
	if control == null:
		return
	# Prefer rect_position for Control
	if _has_property_by_name(control, "rect_position"):
		control.set("rect_position", pos)
		return
	# Fallback to position property
	if _has_property_by_name(control, "position"):
		control.set("position", pos)
		return
	# Last resort: try set("rect_position", pos) anyway
	control.set("rect_position", pos)


# Convert a world-space point to canvas coordinates for labels in a CanvasLayer
func _world_to_canvas_point(world_point: Vector2) -> Vector2:
	# get_canvas_transform maps canvas -> world; we need inverse to map world -> canvas
	var canvas_t := get_viewport().get_canvas_transform()
	var inv := canvas_t.affine_inverse()
	return inv * world_point


# -------------------------
# Ready
# -------------------------
func _ready() -> void:
	print("MapEditor ready")

	# Safe optional lookups
	load_regions_button = ui_root.get_node_or_null("LoadRegionsButton")
	ipc_canvas = ui_root.get_node_or_null("IPCCanvas")

	# Create IPCCanvas if missing (CanvasLayer under ToolLayer/UI)
	if ipc_canvas == null:
		ipc_canvas = CanvasLayer.new()
		ipc_canvas.name = "IPCCanvas"
		ui_root.add_child(ipc_canvas)

	# Connect LoadRegionsButton if present
	if load_regions_button != null:
		load_regions_button.connect("pressed", Callable(self, "_on_load_regions_button_pressed"))
	else:
		print("LoadRegionsButton not found; skipping connection (optional).")

	# Inspector may be required for editing; warn if missing but don't crash
	if inspector == null:
		push_error("InspectorPanel not found at ToolLayer/UI/InspectorPanel. Some UI features will be disabled.")
	else:
		inspector.visible = false


# -------------------------
# Camera panning
# -------------------------
func _process(delta: float) -> void:
	if map_root == null:
		return

	var move: Vector2 = Vector2.ZERO

	if Input.is_action_pressed("ui_right"):
		move.x -= pan_speed * delta
	if Input.is_action_pressed("ui_left"):
		move.x += pan_speed * delta
	if Input.is_action_pressed("ui_down"):
		move.y -= pan_speed * delta
	if Input.is_action_pressed("ui_up"):
		move.y += pan_speed * delta

	map_root.position += move


# -------------------------
# Load map or texture
# -------------------------
func load_map(path: String) -> void:
	print("Loading map:", path)
	if path.to_lower().ends_with(".json"):
		load_map_from_json(path)
		return

	var tex = load(path)
	if tex == null:
		push_error("Failed to load texture at: " + path)
		return

	base_map.texture = tex
	base_map.position = Vector2.ZERO
	print("Map texture loaded successfully.")


# -------------------------
# Robust JSON loader
# -------------------------
func load_map_from_json(path: String) -> void:
	print("Loading map data from JSON:", path)
	var file = FileAccess.open(path, FileAccess.READ)
	if file == null:
		push_error("Could not open JSON: " + path)
		return
	var text: String = file.get_as_text()
	file.close()

	print("DEBUG JSON head:", text.substr(0, min(400, text.length())))

	var parsed = JSON.parse_string(text)

	var data: Dictionary = {}
	if typeof(parsed) == TYPE_DICTIONARY:
		var parse_err = parsed.get("error", null)
		if parse_err != null and parse_err != OK:
			push_error("JSON parse error (dict): " + str(parse_err))
			return
		data = parsed.get("result", {})
	else:
		# fallback: try reparsing into dictionary
		var fallback = JSON.parse_string(text)
		if typeof(fallback) == TYPE_DICTIONARY:
			data = fallback.get("result", {})
		else:
			push_error("Unable to extract JSON result from parse output.")
			return

	if typeof(data) != TYPE_DICTIONARY:
		push_error("JSON top-level result is not a Dictionary. Type: " + str(typeof(data)))
		return

	print("DEBUG: parsed top-level keys:", data.keys())

	# If JSON contains a base_map path, load it
	if data.has("base_map"):
		var bm = str(data.get("base_map", ""))
		if bm != "":
			var tex = load(bm)
			if tex != null:
				base_map.texture = tex
				base_map.position = Vector2.ZERO
				print("Loaded base_map from JSON:", bm)
			else:
				push_error("Could not load base_map texture from JSON path: " + bm)

	# Clear existing regions and IPC labels
	for child in region_layer.get_children():
		child.queue_free()
	if region_list:
		region_list.clear()
	# Clear IPCCanvas children
	if ipc_canvas:
		for c in ipc_canvas.get_children():
			c.queue_free()

	# Recreate regions
	var created_count: int = 0
	for key in data.keys():
		if key == "base_map":
			continue

		var entry = data.get(key, null)
		if typeof(entry) != TYPE_DICTIONARY:
			push_error("Skipping non-dict entry for key: " + str(key))
			continue

		var meta_dict: Dictionary = entry.get("metadata", {})
		var poly_points = entry.get("polygon", [])
		if typeof(poly_points) != TYPE_ARRAY:
			push_error("Skipping region with invalid polygon for key: " + str(key))
			continue

		var pts: Array = []
		for p in poly_points:
			if typeof(p) == TYPE_ARRAY and p.size() >= 2:
				pts.append(Vector2(p[0], p[1]))
			else:
				push_error("Invalid polygon point in key: " + str(key))

		if pts.size() == 0:
			push_error("No valid points for region key: " + str(key))
			continue

		var region: Node2D = Node2D.new()
		region_layer.add_child(region)

		var poly: Polygon2D = Polygon2D.new()
		poly.name = "Polygon2D"
		poly.polygon = pts
		poly.color = Color(1, 0, 0, 0.4)
		region.add_child(poly)

		var area: Area2D = Area2D.new()
		area.name = "Area2D"
		area.input_pickable = true
		region.add_child(area)

		var col: CollisionPolygon2D = CollisionPolygon2D.new()
		col.name = "CollisionPolygon2D"
		col.polygon = pts
		area.add_child(col)

		var meta: RegionMetadata = RegionMetadata.new()
		meta.name = "RegionMetadata"
		meta.region_id = str(meta_dict.get("region_id", meta_dict.get("regionid", "")))
		meta.ipc_value = int(meta_dict.get("ipc", meta_dict.get("ipc_value", 0)))
		meta.faction = str(meta_dict.get("faction", ""))
		meta.is_victory_city = bool(meta_dict.get("victory", false))
		meta.has_factory = bool(meta_dict.get("factory", false))
		region.add_child(meta)

		# create IPC label (Control under CanvasLayer)
		_create_ipc_label_for_region(region, meta.ipc_value)

		# connect input using Callable.bind to avoid overload ambiguity
		var cb: Callable = Callable(self, "_on_region_input_event").bind(region)
		area.connect("input_event", cb)

		var list_name: String = meta.region_id if meta.region_id != "" else "Region_" + str(region.get_index())
		if region_list:
			region_list.add_item(list_name)

		created_count += 1

	print("Map JSON loaded. Regions:", created_count)


# -------------------------
# Start drawing a new region
# -------------------------
func start_new_region() -> void:
	print("Starting new region...")
	is_drawing = true
	drawing_points.clear()
	current_region = null

	preview_poly = Line2D.new()
	preview_poly.width = 2
	preview_poly.default_color = Color.YELLOW
	preview_poly.closed = false
	map_root.add_child(preview_poly)


# -------------------------
# Mouse input for drawing
# -------------------------
func _input(event: InputEvent) -> void:
	if not is_drawing:
		return

	if event is InputEventMouseButton and event.pressed:
		# right-click finishes region
		if event.button_index == MOUSE_BUTTON_RIGHT:
			if drawing_points.size() > 2:
				_finalize_region()
			return

		# left-click adds point
		if event.button_index == MOUSE_BUTTON_LEFT:
			var pos: Vector2 = get_global_mouse_position()
			drawing_points.append(pos)
			print("Added point:", pos)

			if preview_poly:
				preview_poly.points = drawing_points


# -------------------------
# Finalize region creation
# -------------------------
func _finalize_region() -> void:
	print("Finalizing region...")
	is_drawing = false

	if preview_poly:
		preview_poly.queue_free()
		preview_poly = null

	var region: Node2D = Node2D.new()
	region_layer.add_child(region)

	var poly: Polygon2D = Polygon2D.new()
	poly.name = "Polygon2D"
	poly.polygon = drawing_points
	poly.color = Color(1, 0, 0, 0.4)
	region.add_child(poly)

	var area: Area2D = Area2D.new()
	area.name = "Area2D"
	area.input_pickable = true
	region.add_child(area)

	var col: CollisionPolygon2D = CollisionPolygon2D.new()
	col.name = "CollisionPolygon2D"
	col.polygon = drawing_points
	area.add_child(col)

	var meta: RegionMetadata = RegionMetadata.new()
	meta.name = "RegionMetadata"
	region.add_child(meta)

	# create IPC label (Control under CanvasLayer)
	_create_ipc_label_for_region(region, meta.ipc_value)

	# Use a Callable bound to the region (no ambiguous overloads)
	var cb2: Callable = Callable(self, "_on_region_input_event").bind(region)
	area.connect("input_event", cb2)

	current_region = region
	_select_region(region)

	if region_list:
		region_list.add_item("New Region")


# -------------------------
# IPC label creation (Control under CanvasLayer)
# -------------------------
func _create_ipc_label_for_region(region: Node2D, ipc_value: int) -> void:
	if ipc_canvas == null:
		return

	# unique key per region
	var key: String = "IPC_UI_" + str(region.get_index())
	var existing := ipc_canvas.get_node_or_null(key)
	if existing:
		existing.queue_free()

	# Create a Control Label under the CanvasLayer
	var label := Label.new()
	label.name = key
	label.text = str(ipc_value)
	# optional style tweaks
	# label.add_theme_color_override("font_color", Color.white)  # if you use theme overrides
	# label.add_theme_font_override("font", preload("res://path/to/font.tres"))

	# compute centroid in region local coords and convert to canvas coords
	var poly: Polygon2D = region.get_node_or_null("Polygon2D")
	var centroid: Vector2 = Vector2.ZERO
	if poly:
		centroid = _polygon_centroid(poly.polygon)
	# region.to_global converts local centroid to world
	var global_pos := region.to_global(centroid)
	var ui_pos := _world_to_canvas_point(global_pos)

	# set position safely
	_set_control_position(label, ui_pos)

	# z_index on Control is sometimes available; set if present
	if _has_property_by_name(label, "z_index"):
		label.set("z_index", -10)

	ipc_canvas.add_child(label)


# Update IPC label for a region (call after metadata changes)
func update_ipc_label_for_region(region: Node2D) -> void:
	if ipc_canvas == null or region == null:
		return
	var key: String = "IPC_UI_" + str(region.get_index())
	var label := ipc_canvas.get_node_or_null(key)
	var meta: RegionMetadata = region.get_node_or_null("RegionMetadata")
	if label and meta:
		label.text = str(meta.ipc_value)
		var poly: Polygon2D = region.get_node_or_null("Polygon2D")
		if poly:
			var centroid := _polygon_centroid(poly.polygon)
			var global_pos := region.to_global(centroid)
			var ui_pos := _world_to_canvas_point(global_pos)
			_set_control_position(label, ui_pos)


# -------------------------
# Polygon centroid
# -------------------------
func _polygon_centroid(points: Array) -> Vector2:
	if points.size() == 0:
		return Vector2.ZERO
	var sum: Vector2 = Vector2.ZERO
	for p in points:
		sum += p
	return sum / points.size()


# -------------------------
# Region input handler
# -------------------------
func _on_region_input_event(viewport, event, shape_idx, region: Node) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		_select_region(region)


# -------------------------
# Select region
# -------------------------
func _select_region(region: Node2D) -> void:
	print("Selected region:", region)
	current_region = region
	if inspector != null:
		inspector.visible = true
		inspector.set_region(region)

	for r in region_layer.get_children():
		var p: Polygon2D = r.get_node_or_null("Polygon2D")
		if p:
			p.color = Color(1, 0, 0, 0.4) if r != region else Color(0.2, 0.8, 0.2, 0.5)


# -------------------------
# Button handlers
# -------------------------
func _on_load_map_button_pressed() -> void:
	print("Load Map button pressed")
	var dialog = FileDialog.new()
	dialog.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	dialog.filters = ["*.png ; PNG Images", "*.jpg ; JPEG Images", "*.json ; Map JSON"]
	add_child(dialog)
	dialog.connect("file_selected", Callable(self, "load_map"))
	dialog.popup_centered()


func _on_load_regions_button_pressed() -> void:
	print("Load Regions button pressed")
	var dialog = FileDialog.new()
	dialog.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	dialog.filters = ["*.json ; Map JSON"]
	add_child(dialog)
	dialog.connect("file_selected", Callable(self, "load_map_from_json"))
	dialog.popup_centered()


func _on_add_region_button_pressed() -> void:
	print("Add Region button pressed")
	start_new_region()


func _on_save_button_pressed() -> void:
	print("Save Map button pressed")
	save_map("res://exported_map.json")


# -------------------------
# Save map to JSON
# -------------------------
func save_map(path: String) -> void:
	print("Saving map...")

	var data: Dictionary = {}

	# include base_map texture path if available
	var bm_path: String = ""
	if base_map.texture != null and base_map.texture.resource_path != "":
		bm_path = base_map.texture.resource_path
		data["base_map"] = bm_path

	for region in region_layer.get_children():
		var meta: RegionMetadata = region.get_node_or_null("RegionMetadata")
		if meta == null:
			push_error("Skipping region without RegionMetadata: " + str(region))
			continue

		var poly: Polygon2D = region.get_node_or_null("Polygon2D")
		if poly == null:
			push_error("Skipping region without Polygon2D: " + str(region))
			continue

		var pts: Array = []
		for v in poly.polygon:
			pts.append([v.x, v.y])

		# use region_id as key (may be empty string)
		data[meta.region_id] = {
			"metadata": meta.to_dict(),
			"polygon": pts
		}

	var file = FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		push_error("Could not open file for writing: " + path)
		return

	file.store_string(JSON.stringify(data, "\t"))
	file.close()

	print("Map saved to:", path)
