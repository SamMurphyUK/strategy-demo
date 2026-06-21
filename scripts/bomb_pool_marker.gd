extends Node2D
class_name BombPoolMarker

signal clicked(region_id: String)

var region_id: String = ""
var bomber_count: int = 0

var _hit_area: Area2D
var _icon_size: float = UnitIcon.UNIT_ICON_SIZE * 1.15


func _ready() -> void:
	z_index = UnitLayout.get_z_order("movement_arrow") + 1
	_build_hit_area()


func configure(p_region_id: String, count: int) -> void:
	region_id = p_region_id
	bomber_count = maxi(0, count)
	visible = bomber_count > 0
	queue_redraw()


func _draw() -> void:
	if bomber_count <= 0:
		return
	var half := _icon_size * 0.5
	var font := ThemeDB.fallback_font
	var font_size := int(_icon_size * 0.75)
	var pos := Vector2(-half, -half * 1.3)
	draw_string(font, pos, "B", HORIZONTAL_ALIGNMENT_CENTER, _icon_size, font_size, Color(0.95, 0.55, 0.1, 1.0))

	var badge_radius := 11.0
	var badge_center := Vector2(half * 0.35, -half * 1.7)
	draw_circle(badge_center, badge_radius, Color(0.85, 0.35, 0.1, 0.95))
	var count_text := str(bomber_count)
	var count_size := font.get_string_size(count_text, HORIZONTAL_ALIGNMENT_CENTER, -1, 12)
	draw_string(
		font,
		badge_center - count_size * 0.5 + Vector2(0, count_size.y * 0.35),
		count_text,
		HORIZONTAL_ALIGNMENT_LEFT,
		-1,
		12,
		Color.WHITE
	)


func _build_hit_area() -> void:
	_hit_area = Area2D.new()
	_hit_area.input_pickable = true
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	var hit_size := UnitIcon.UNIT_ICON_SIZE * 1.3
	rect.size = Vector2(hit_size, hit_size)
	shape.shape = rect
	shape.position = Vector2(0, -hit_size * 0.35)
	_hit_area.add_child(shape)
	add_child(_hit_area)
	_hit_area.input_event.connect(_on_hit_area_input)


func _on_hit_area_input(_viewport: Node, event: InputEvent, _shape_idx: int) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		get_viewport().set_input_as_handled()
		clicked.emit(region_id)
