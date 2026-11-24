extends Node2D

signal region_selected(region_id: String)

func _ready() -> void:
	print("Test scene ready")
	
	# Create a simple clickable region
	var region = _create_test_region("test_region_1", [
		Vector2(100, 100),
		Vector2(300, 100),
		Vector2(300, 250),
		Vector2(100, 250)
	])
	$RegionLayer.add_child(region)
	
	# Connect to our own signal for testing
	region_selected.connect(_on_region_selected)
	
	print("Test region created. Click inside the red rectangle.")


func _create_test_region(region_id: String, points: Array) -> Node2D:
	var region = Node2D.new()
	region.name = region_id

	var pts = PackedVector2Array(points)

	# Visual polygon
	var poly = Polygon2D.new()
	poly.name = "Polygon2D"
	poly.polygon = pts
	poly.color = Color(1, 0, 0, 0.5)
	region.add_child(poly)

	# Area2D for click detection
	var area = Area2D.new()
	area.name = "Area2D"
	area.input_pickable = true
	region.add_child(area)

	# CollisionPolygon2D as child of Area2D
	var col = CollisionPolygon2D.new()
	col.name = "CollisionPolygon2D"
	col.polygon = pts
	area.add_child(col)

	# Connect with bound region_id
	area.input_event.connect(_on_area_input_event.bind(region_id))
	
	print("Created Area2D, input_pickable=", area.input_pickable)
	print("CollisionPolygon2D points=", col.polygon.size())

	return region


func _on_area_input_event(viewport: Viewport, event: InputEvent, shape_idx: int, region_id: String) -> void:
	print("Input event received:", event.get_class(), "for region:", region_id)
	
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		print("LEFT CLICK on region:", region_id)
		region_selected.emit(region_id)
		get_viewport().set_input_as_handled()


func _on_region_selected(region_id: String) -> void:
	print("=== REGION SELECTED:", region_id, "===")
