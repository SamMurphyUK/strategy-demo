extends Node2D
class_name MapEditor

@onready var map_root: Node2D = $MapRoot
@onready var base_map: Sprite2D = $MapRoot/BaseMap
@onready var region_layer: Node2D = $MapRoot/RegionLayer

@onready var inspector = $ToolLayer/UI/InspectorPanel
@onready var region_list = $ToolLayer/UI/RegionList

var current_region: Node2D = null
var drawing_points: Array = []
var is_drawing: bool = false

var preview_poly: Line2D = null
var pan_speed: float = 500.0


func _ready() -> void:
	print("MapEditor ready")
	inspector.visible = false


# ---------------------------------------------------------
# CAMERA PANNING
# ---------------------------------------------------------
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


# ---------------------------------------------------------
# LOAD MAP OR JSON
# ---------------------------------------------------------
func load_map(path: String) -> void:
	print("Loading map:", path)
	if path.to_lower().ends_with(".json"):
		_load_map_from_json(path)
		return

	var tex = load(path)
	if tex == null:
		push_error("Failed to load texture at: " + path)
		return

	base_map.texture = tex
	base_map.position = Vector2.ZERO
	print("Map texture loaded successfully.")


func _load_map_from_json(path: String) -> void:
	print("Loading map data from JSON:", path)
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		push_error("Could not open JSON: " + path)
		return
	var text: String = file.get_as_text()
	file.close()

	var parsed = JSON.parse_string(text)
	# parsed is a Dictionary; access keys with get()
	var parse_error = parsed.get("error", null)
	if parse_error != null and parse_error != OK:
		push_error("JSON parse error: " + str(parse_error))
		return

	var data = parsed.get("result", {})
	if typeof(data) != TYPE_DICTIONARY:
		push_error("JSON did not contain an object at top level.")
		return

	# clear existing regions
	for child in region_layer.get_children():
		child.queue_free()

	for key in data.keys():
		var entry = data.get(key, null)
		if typeof(entry) != TYPE_DICTIONARY:
			push_error("Skipping invalid region entry for key: " + str(key))
			continue

		var meta_dict: Dictionary = entry.get("metadata", {})
		var poly_points = entry.get("polygon", [])
		if typeof(poly_points) != TYPE_ARRAY:
			push_error("Skipping region with invalid polygon: " + str(key))
			continue

		var pts: Array = []
		for p in poly_points:
			if typeof(p) == TYPE_ARRAY and p.size() >= 2:
				pts.append(Vector2(p[0], p[1]))
			else:
				push_error("Invalid point in polygon for region: " + str(key))

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
		meta.region_id = str(meta_dict.get("region_id", ""))
		meta.ipc_value = int(meta_dict.get("ipc", 0))
		meta.faction = str(meta_dict.get("faction", ""))
		meta.is_victory_city = bool(meta_dict.get("victory", false))
		meta.has_factory = bool(meta_dict.get("factory", false))
		region.add_child(meta)

		_create_ipc_label_for_region(region, meta.ipc_value)

		# Use a Callable bound to the region (no ambiguous overloads)
		var cb: Callable = Callable(self, "_on_region_input_event").bind(region)
		area.connect("input_event", cb)

	print("Map JSON loaded.")


# ---------------------------------------------------------
# START DRAWING A NEW REGION
# ---------------------------------------------------------
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


# ---------------------------------------------------------
# HANDLE MOUSE INPUT FOR DRAWING
# ---------------------------------------------------------
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


# ---------------------------------------------------------
# FINALIZE REGION CREATION
# ---------------------------------------------------------
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

	_create_ipc_label_for_region(region, meta.ipc_value)

	# Use a Callable bound to the region (no ambiguous overloads)
	var cb2: Callable = Callable(self, "_on_region_input_event").bind(region)
	area.connect("input_event", cb2)

	current_region = region
	_select_region(region)

	region_list.add_item("New Region")


# Create a Label (Control) showing IPC at polygon centroid
func _create_ipc_label_for_region(region: Node2D, ipc_value: int) -> void:
	var existing = region.get_node_or_null("IPCLabel")
	if existing:
		existing.queue_free()

	var poly: Polygon2D = region.get_node_or_null("Polygon2D")
	if poly == null:
		return

	var centroid: Vector2 = _polygon_centroid(poly.polygon)

	var label: Label = Label.new()
	label.name = "IPCLabel"
	label.text = str(ipc_value)
	# Use position (works for Control in Godot 4) instead of rect_position
	# position is in parent local coordinates
	label.position = centroid
	label.z_index = 100
	region.add_child(label)

	# Defer centering so minimum size is available
	call_deferred("_deferred_center_label", label)


func _deferred_center_label(label: Label) -> void:
	if not is_instance_valid(label):
		return
	var size: Vector2 = label.get_minimum_size()
	# center the label on the centroid
	label.position -= size * 0.5


func _polygon_centroid(points: Array) -> Vector2:
	if points.size() == 0:
		return Vector2.ZERO
	var sum: Vector2 = Vector2.ZERO
	for p in points:
		sum += p
	return sum / points.size()


# ---------------------------------------------------------
# REGION SELECTION (click)
# ---------------------------------------------------------
# Handler signature: (viewport, event, shape_idx, region)
func _on_region_input_event(viewport, event, shape_idx, region: Node) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		_select_region(region)


# ---------------------------------------------------------
# SELECT REGION
# ---------------------------------------------------------
func _select_region(region: Node2D) -> void:
	print("Selected region:", region)
	current_region = region
	inspector.visible = true
	inspector.set_region(region)

	for r in region_layer.get_children():
		var p: Polygon2D = r.get_node_or_null("Polygon2D")
		if p:
			p.color = Color(1, 0, 0, 0.4) if r != region else Color(0.2, 0.8, 0.2, 0.5)


# ---------------------------------------------------------
# BUTTON HANDLERS
# ---------------------------------------------------------
func _on_load_map_button_pressed() -> void:
	print("Load Map button pressed")
	var dialog: FileDialog = FileDialog.new()
	dialog.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	dialog.filters = ["*.png ; PNG Images", "*.jpg ; JPEG Images", "*.json ; Map JSON"]
	add_child(dialog)
	# connect using Callable (no binds)
	dialog.connect("file_selected", Callable(self, "load_map"))
	dialog.popup_centered()


func _on_add_region_button_pressed() -> void:
	print("Add Region button pressed")
	start_new_region()


func _on_save_button_pressed() -> void:
	print("Save Map button pressed")
	save_map("res://exported_map.json")


# ---------------------------------------------------------
# SAVE MAP TO JSON (robust, numeric arrays)
# ---------------------------------------------------------
func save_map(path: String) -> void:
	print("Saving map...")

	var data: Dictionary = {}

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

	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		push_error("Could not open file for writing: " + path)
		return

	file.store_string(JSON.stringify(data, "\t"))
	file.close()

	print("Map saved to:", path)
