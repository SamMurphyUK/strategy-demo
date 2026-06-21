extends Node2D
class_name CombatPoolMarker

signal clicked(region_id: String)

var region_id: String = ""
var pool_count: int = 0

var _badge: Panel
var _badge_label: Label
var _x_label: Label
var _hit_area: Area2D


func _ready() -> void:
	z_index = UnitLayout.get_z_order("movement_arrow") + 1
	_build_visual()
	_build_hit_area()


func configure(p_region_id: String, count: int) -> void:
	region_id = p_region_id
	pool_count = maxi(0, count)
	if _badge_label:
		_badge_label.text = str(pool_count)
	visible = pool_count > 0


func _build_visual() -> void:
	var size := UnitIcon.UNIT_ICON_SIZE * 1.15

	_x_label = Label.new()
	_x_label.text = "X"
	_x_label.add_theme_color_override("font_color", Color(0.95, 0.15, 0.15, 1.0))
	_x_label.add_theme_font_size_override("font_size", int(size * 0.85))
	_x_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_x_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_x_label.position = Vector2(-size * 0.5, -size * 0.65)
	_x_label.size = Vector2(size, size)
	add_child(_x_label)

	_badge = Panel.new()
	var badge_size := 22.0
	_badge.position = Vector2(size * 0.15, -size * 0.85)
	_badge.custom_minimum_size = Vector2(badge_size, badge_size)
	_badge.size = Vector2(badge_size, badge_size)
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.2, 0.55, 0.95, 0.95)
	style.corner_radius_top_left = 11
	style.corner_radius_top_right = 11
	style.corner_radius_bottom_right = 11
	style.corner_radius_bottom_left = 11
	_badge.add_theme_stylebox_override("panel", style)
	add_child(_badge)

	_badge_label = Label.new()
	_badge_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_badge_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_badge_label.add_theme_font_size_override("font_size", 12)
	_badge_label.add_theme_color_override("font_color", Color.WHITE)
	_badge_label.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_badge.add_child(_badge_label)


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
		clicked.emit(region_id)
