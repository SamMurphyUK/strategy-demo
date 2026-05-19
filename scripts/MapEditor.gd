extends Node2D
class_name MapEditor

# -------------------------
# Core scene nodes (must exist)
# -------------------------
@onready var map_root: Node2D = $MapRoot
@onready var base_map: Sprite2D = $MapRoot/BaseMap
@onready var region_layer: Node2D = $MapRoot/RegionLayer

# UI nodes
@onready var inspector: Node = $ToolLayer/UI/InspectorPanel
@onready var region_list: ItemList = $ToolLayer/UI/RegionList
@onready var ui_root: Node = $ToolLayer/UI

# Optional UI nodes
var load_regions_button: Button = null

# Editor state
var current_region: Node2D = null
var drawing_points: Array = []
var is_drawing: bool = false
var preview_poly: Line2D = null
var pan_speed: float = 500.0


# -------------------------
# Ready
# -------------------------
func _ready() -> void:
	print("MapEditor ready")

	load_regions_button = ui_root.get_node_or_null("LoadRegionsButton")

	if load_regions_button != null:
		load_regions_button.connect("pressed", Callable(self, "_on_load_regions_button_pressed"))
	else:
		print("LoadRegionsButton not found; skipping connection (optional).")

	if inspector == null:
		push_error("InspectorPanel not found at ToolLayer/UI/InspectorPanel.")
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
# JSON loader (FIXED for Godot 4.x)
# -------------------------
func load_map_from_json(path: String) -> void:
	print("Loading map data from JSON:", path)

	var file = FileAccess.open(path, FileAccess.READ)
	if file == null:
		push_error("Could not open JSON: " + path)
		return

	var text: String = file.get_as_text()
	file.close()

	print("DEBUG JSON head:", text.substr(0, min(600, text.length())))

	# Godot 4.x: parse_string returns the data directly, NOT a dict with "result"
	var data = JSON.parse_string(text)

	if data == null:
		push_error("JSON parse failed - returned null")
		return

	if typeof(data) != TYPE_DICTIONARY:
		push_error("JSON root is not a Dictionary. Type: " + str(typeof(data)))
		return

	print("DEBUG: parsed top-level keys:", data.keys())

	# Load base map texture if present
	if data.has("base_map"):
		var bm: String = str(data["base_map"])
		if bm != "":
			var tex = load(bm)
			if tex != null:
				base_map.texture = tex
				base_map.position = Vector2.ZERO
				print("Loaded base_map from JSON:", bm)
			else:
				push_error("Could not load base_map texture: " + bm)

	# Clear existing regions
	for child in region_layer.get_children():
		child.queue_free()
	if region_list:
		region_list.clear()

	# Recreate regions
	var created_count: int = 0

	for key in data.keys():
		if key == "base_map":
			continue

		var entry = data[key]
		if typeof(entry) != TYPE_DICTIONARY:
			push_error("Skipping non-dict entry for key: " + str(key))
			continue

		var meta_dict: Dictionary = entry.get("metadata", {})
		var poly_points = entry.get("polygon", [])

		if typeof(poly_points) != TYPE_ARRAY:
			push_error("Skipping region with invalid polygon for key: " + str(key))
			continue

		# Convert [[x,y], ...] to Vector2 array
		var pts: Array = []
		for p in poly_points:
			if typeof(p) == TYPE_ARRAY and p.size() >= 2:
				pts.append(Vector2(p[0], p[1]))

		if pts.size() == 0:
			push_error("No valid points for region key: " + str(key))
			continue

		# Build region node
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

		# Connect click handler
		var cb: Callable = Callable(self, "_on_region_input_event").bind(region)
		area.connect("input_event", cb)

		var list_name: String = meta.region_id if meta.region_id != "" else "Region_" + str(created_count)
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
		if event.button_index == MOUSE_BUTTON_RIGHT:
			if drawing_points.size() > 2:
				_finalize_region()
			return

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

	var cb: Callable = Callable(self, "_on_region_input_event").bind(region)
	area.connect("input_event", cb)

	current_region = region
	_select_region(region)

	if region_list:
		region_list.add_item("New Region")


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

	if base_map.texture != null and base_map.texture.resource_path != "":
		data["base_map"] = base_map.texture.resource_path

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
