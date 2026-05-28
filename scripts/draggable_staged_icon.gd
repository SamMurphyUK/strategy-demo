extends TextureRect
class_name DraggableStagedIcon

signal dropped_on_map(data: Dictionary, global_position: Vector2)

var drag_data: Dictionary = {}

func _get_drag_data(_at_position: Vector2) -> Variant:
	var preview := TextureRect.new()
	preview.texture = texture
	preview.custom_minimum_size = Vector2(24, 24)
	set_drag_preview(preview)
	return drag_data

func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and not event.pressed:
		if not drag_data.is_empty():
			dropped_on_map.emit(drag_data, get_global_mouse_position())
