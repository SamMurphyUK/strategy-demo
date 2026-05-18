extends Node2D
class_name MapEditor

@onready var base_map := $BaseMap
@onready var region_layer := $RegionLayer
@onready var inspector := $ToolLayer/UI/InspectorPanel
@onready var region_list := $ToolLayer/UI/RegionList

var current_region = null
var drawing_points: Array[Vector2] = []
var is_drawing := false

func _ready():
	print("MapEditor ready")
	inspector.visible = false

func load_map(path: String):
	var tex = load(path)
	base_map.texture = tex
	base_map.position = Vector2.ZERO

func start_new_region():
	is_drawing = true
	drawing_points.clear()
	current_region = null
	print("Drawing new region...")

func _input(event):
	if not is_drawing:
		return

	if event is InputEventMouseButton and event.pressed:
		var pos = get_global_mouse_position()
		drawing_points.append(pos)

		if drawing_points.size() > 2 and event.double_click:
			_finalize_region()

func _finalize_region():
	is_drawing = false

	var region = Node2D.new()
	region_layer.add_child(region)

	var poly = Polygon2D.new()
	poly.polygon = drawing_points
	poly.color = Color(0.2, 0.6, 1.0, 0.4)
	region.add_child(poly)

	var col = CollisionPolygon2D.new()
	col.polygon = drawing_points
	region.add_child(col)

	var meta = RegionMetadata.new()
	region.add_child(meta)

	current_region = region
	_select_region(region)

func _select_region(region):
	current_region = region
	inspector.visible = true
	inspector.set_region(region)
