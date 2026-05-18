extends Node2D
class_name MapEditor

@onready var map_root: Node2D = $MapRoot
@onready var base_map: Sprite2D = $MapRoot/BaseMap
@onready var region_layer: Node2D = $MapRoot/RegionLayer

@onready var inspector = $ToolLayer/UI/InspectorPanel
@onready var region_list = $ToolLayer/UI/RegionList

var current_region: Node2D = null
var drawing_points: Array[Vector2] = []
var is_drawing: bool = false

var preview_poly: Line2D = null
var pan_speed := 500.0


func _ready():
	print("MapEditor ready")
	inspector.visible = false


# ---------------------------------------------------------
# CAMERA PANNING
# ---------------------------------------------------------
func _process(delta):
	if map_root == null:
		return

	var move := Vector2.ZERO

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
# LOAD MAP
# ---------------------------------------------------------
func load_map(path: String):
	print("Loading map:", path)

	var tex := load(path)
	if tex == null:
		push_error("Failed to load texture at: " + path)
		return

	base_map.texture = tex
	base_map.position = Vector2.ZERO

	print("Map loaded successfully.")


# ---------------------------------------------------------
# START DRAWING A NEW REGION
# ---------------------------------------------------------
func start_new_region():
	print("Starting new region...")
	is_drawing = true
	drawing_points.clear()
	current_region = null

	# Create preview outline
	preview_poly = Line2D.new()
	preview_poly.width = 2
	preview_poly.default_color = Color.YELLOW
	preview_poly.closed = false
	map_root.add_child(preview_poly)


# ---------------------------------------------------------
# HANDLE MOUSE INPUT FOR DRAWING
# ---------------------------------------------------------
func _input(event):
	if not is_drawing:
		return

	if event is InputEventMouseButton and event.pressed:

		# Right-click finishes region
		if event.button_index == MOUSE_BUTTON_RIGHT:
			if drawing_points.size() > 2:
				_finalize_region()
			return

		# Left-click adds point
		if event.button_index == MOUSE_BUTTON_LEFT:
			var pos = get_global_mouse_position()
			drawing_points.append(pos)
			print("Added point:", pos)

			if preview_poly:
				preview_poly.points = drawing_points


# ---------------------------------------------------------
# FINALIZE REGION CREATION
# ---------------------------------------------------------
func _finalize_region():
	print("Finalizing region...")
	is_drawing = false

	# Remove preview
	if preview_poly:
		preview_poly.queue_free()
		preview_poly = null

	var region := Node2D.new()
	region_layer.add_child(region)

	var poly := Polygon2D.new()
	poly.polygon = drawing_points
	poly.color = Color(1, 0, 0, 0.4) # visible red
	region.add_child(poly)

	var col := CollisionPolygon2D.new()
	col.polygon = drawing_points
	region.add_child(col)

	# --- FIX: Create metadata node correctly ---
	var meta := RegionMetadata.new()
	meta.name = "RegionMetadata"   # REQUIRED
	region.add_child(meta)

	current_region = region
	_select_region(region)

	region_list.add_item("New Region")


# ---------------------------------------------------------
# SELECT REGION
# ---------------------------------------------------------
func _select_region(region: Node2D):
	print("Selected region:", region)
	current_region = region
	inspector.visible = true
	inspector.set_region(region)


# ---------------------------------------------------------
# BUTTON HANDLERS
# ---------------------------------------------------------
func _on_load_map_button_pressed():
	print("Load Map button pressed")
	var dialog := FileDialog.new()
	dialog.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	dialog.filters = ["*.png ; PNG Images", "*.jpg ; JPEG Images"]
	add_child(dialog)
	dialog.file_selected.connect(load_map)
	dialog.popup_centered()


func _on_add_region_button_pressed():
	print("Add Region button pressed")
	start_new_region()


func _on_save_button_pressed():
	print("Save Map button pressed")
	save_map("res://exported_map.json")


# ---------------------------------------------------------
# SAVE MAP TO JSON
# ---------------------------------------------------------
func save_map(path: String):
	print("Saving map...")

	var data := {}

	for region in region_layer.get_children():
		var meta: RegionMetadata = region.get_node("RegionMetadata")
		var poly: Polygon2D = region.get_node("Polygon2D")

		data[meta.region_id] = {
			"metadata": meta.to_dict(),
			"polygon": poly.polygon
		}

	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		push_error("Could not open file for writing: " + path)
		return

	file.store_string(JSON.stringify(data, "\t"))
	file.close()

	print("Map saved to:", path)
