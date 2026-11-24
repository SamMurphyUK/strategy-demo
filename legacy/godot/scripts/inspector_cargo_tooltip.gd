extends PanelContainer
class_name InspectorCargoTooltip

var _title: Label
var _body: Label


func _ready() -> void:
	visible = false
	set_as_top_level(true)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	z_index = 100
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.1, 0.1, 0.14, 0.72)
	style.border_color = Color(0.55, 0.55, 0.65, 0.85)
	style.set_border_width_all(1)
	style.set_corner_radius_all(6)
	add_theme_stylebox_override("panel", style)

	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 10)
	margin.add_theme_constant_override("margin_top", 8)
	margin.add_theme_constant_override("margin_right", 10)
	margin.add_theme_constant_override("margin_bottom", 8)
	add_child(margin)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 4)
	margin.add_child(vbox)

	_title = Label.new()
	_title.add_theme_color_override("font_color", Color(0.98, 0.98, 1.0, 1.0))
	_title.add_theme_font_size_override("font_size", 13)
	vbox.add_child(_title)

	_body = Label.new()
	_body.autowrap_mode = TextServer.AUTOWRAP_OFF
	_body.add_theme_color_override("font_color", Color(0.95, 0.95, 0.98, 1.0))
	_body.add_theme_font_size_override("font_size", 12)
	vbox.add_child(_body)


func show_cargo(unit_type_id: String, lines: Array, anchor_global: Vector2) -> void:
	if _title == null or _body == null:
		_ready()
	_title.text = "%s cargo" % unit_type_id.capitalize()
	var body_text := ""
	for i in range(lines.size()):
		if i > 0:
			body_text += "\n"
		body_text += str(lines[i])
	_body.text = body_text
	visible = true
	await get_tree().process_frame
	var tooltip_size := get_combined_minimum_size()
	var pos := anchor_global + Vector2(-tooltip_size.x * 0.5, -tooltip_size.y - 10.0)
	position = pos


func hide_tooltip() -> void:
	visible = false
