extends TextureRect
class_name DraggableStagedIcon

signal drag_started(icon: DraggableStagedIcon)
signal drag_updated(icon: DraggableStagedIcon, global_position: Vector2)
signal drag_ended(icon: DraggableStagedIcon, global_position: Vector2)
signal drag_cancelled(icon: DraggableStagedIcon)

var drag_data: Dictionary = {}


func configure(data: Dictionary) -> void:
	drag_data = data.duplicate(true)

var _dragging: bool = false


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	custom_minimum_size = Vector2(UnitIcon.UNIT_ICON_SIZE, UnitIcon.UNIT_ICON_SIZE)
	size = Vector2(UnitIcon.UNIT_ICON_SIZE, UnitIcon.UNIT_ICON_SIZE)
	size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	size_flags_vertical = Control.SIZE_SHRINK_CENTER


func get_payload() -> Dictionary:
	return drag_data.duplicate(true)


func get_drag_start_global() -> Vector2:
	return get_global_rect().get_center()


func clear_drag_state() -> void:
	_dragging = false
	set_process_unhandled_input(false)


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			_dragging = true
			set_process_unhandled_input(true)
			drag_started.emit(self)
			accept_event()
		elif _dragging:
			_finish_drag(event.global_position)
	elif event is InputEventMouseMotion and _dragging:
		drag_updated.emit(self, event.global_position)


func _unhandled_input(event: InputEvent) -> void:
	if not _dragging:
		return
	if event is InputEventMouseMotion:
		drag_updated.emit(self, event.global_position)
	elif event is InputEventMouseButton and not event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		_finish_drag(event.global_position)
	elif event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE:
		_cancel_drag()


func _finish_drag(global_pos: Vector2) -> void:
	clear_drag_state()
	drag_ended.emit(self, global_pos)


func _cancel_drag() -> void:
	clear_drag_state()
	drag_cancelled.emit(self)
