extends CanvasLayer
class_name DragController

signal movement_drop_requested(
	from_region_id: String,
	to_region_id: String,
	unit_type_id: String,
	count: int
)
signal mobilize_drop_requested(payload: Dictionary, map_global_position: Vector2)
signal drag_cancelled()

enum DragSource { MAP_ICON, MOBILIZE_UI, COMBAT_UI }

@export var drag_icon_container: Control

var _unit_visualizer: Node2D = null
var _map_root: Node2D = null
var _movement_arrow: Line2D = null
var _unit_icon_scene: PackedScene = null

var _current_phase: String = ""
var _adjacency: Dictionary = {}
var _last_snapshot: Dictionary = {}

var _active_icon: UnitIcon = null
var _preview_icon: UnitIcon = null
var _drag_source: DragSource = DragSource.MAP_ICON
var _drag_payload: Dictionary = {}

var _original_parent: Node = null
var _original_position: Vector2 = Vector2.ZERO
var _original_z_index: int = 0
var _original_visible: bool = true
var _drag_start_map_global: Vector2 = Vector2.ZERO
var _hover_region: String = ""
var _drag_active: bool = false


func _ready() -> void:
	layer = 10
	follow_viewport_enabled = true
	if drag_icon_container == null:
		drag_icon_container = get_node_or_null("DragIconContainer") as Control
	if drag_icon_container:
		drag_icon_container.mouse_filter = Control.MOUSE_FILTER_IGNORE


func configure(
	unit_visualizer: Node2D,
	map_root: Node2D,
	movement_arrow: Line2D,
	unit_icon_scene: PackedScene
) -> void:
	_unit_visualizer = unit_visualizer
	_map_root = map_root
	_movement_arrow = movement_arrow
	_unit_icon_scene = unit_icon_scene


func set_context(
	current_phase: String,
	adjacency: Dictionary,
	snapshot: Dictionary = {}
) -> void:
	_current_phase = current_phase
	_adjacency = adjacency
	_last_snapshot = snapshot


func bind_map_icon(icon: UnitIcon) -> void:
	if not icon.drag_started.is_connected(_on_map_icon_drag_started):
		icon.drag_started.connect(_on_map_icon_drag_started)
	if not icon.drag_updated.is_connected(_on_map_icon_drag_updated):
		icon.drag_updated.connect(_on_map_icon_drag_updated)
	if not icon.drag_ended.is_connected(_on_map_icon_drag_ended):
		icon.drag_ended.connect(_on_map_icon_drag_ended)
	if not icon.drag_cancelled.is_connected(_on_map_icon_drag_cancelled):
		icon.drag_cancelled.connect(_on_map_icon_drag_cancelled)


func unbind_map_icon(icon: UnitIcon) -> void:
	if icon.drag_started.is_connected(_on_map_icon_drag_started):
		icon.drag_started.disconnect(_on_map_icon_drag_started)
	if icon.drag_updated.is_connected(_on_map_icon_drag_updated):
		icon.drag_updated.disconnect(_on_map_icon_drag_updated)
	if icon.drag_ended.is_connected(_on_map_icon_drag_ended):
		icon.drag_ended.disconnect(_on_map_icon_drag_ended)
	if icon.drag_cancelled.is_connected(_on_map_icon_drag_cancelled):
		icon.drag_cancelled.disconnect(_on_map_icon_drag_cancelled)


func start_mobilize_drag(payload: Dictionary, screen_global: Vector2) -> void:
	if not _mobilize_phase_active():
		return
	_begin_ui_drag(DragSource.MOBILIZE_UI, payload, screen_global)


func start_combat_drag(payload: Dictionary, screen_global: Vector2) -> void:
	if not _combat_phase_active():
		return
	_begin_ui_drag(DragSource.COMBAT_UI, payload, screen_global)


func cancel_active_drag() -> void:
	if not _drag_active:
		return
	_cancel_drag()


func is_drag_active() -> bool:
	return _drag_active


func _movement_phase_active() -> bool:
	return _current_phase in ["combat_move", "noncombat_move"]


func _mobilize_phase_active() -> bool:
	return _current_phase == "mobilize"


func _combat_phase_active() -> bool:
	return _current_phase == "combat"


func _on_map_icon_drag_started(icon: UnitIcon) -> void:
	if _drag_active:
		return
	if not _movement_phase_active():
		icon.clear_drag_state()
		return
	_begin_map_drag(icon, icon.global_position)


func _on_map_icon_drag_updated(icon: UnitIcon, screen_global: Vector2) -> void:
	if not _drag_active or _active_icon != icon:
		return
	_update_drag(screen_global)


func _on_map_icon_drag_ended(icon: UnitIcon, screen_global: Vector2) -> void:
	if not _drag_active or _active_icon != icon:
		return
	_end_drag(screen_global)


func _on_map_icon_drag_cancelled(icon: UnitIcon) -> void:
	if _active_icon == icon:
		_cancel_drag()


func _begin_map_drag(icon: UnitIcon, screen_global: Vector2) -> void:
	_drag_source = DragSource.MAP_ICON
	_active_icon = icon
	_drag_payload = {}
	_drag_start_map_global = icon.global_position
	_store_original_transform(icon)
	icon.visible = false
	icon.set_selected(true)
	_spawn_preview_from_icon(icon)
	_position_preview(screen_global)
	_show_movement_arrow(_drag_start_map_global, screen_global)
	_highlight_hover(screen_global, icon.source_region_id)
	_drag_active = true
	set_process_unhandled_input(true)


func _begin_ui_drag(source: DragSource, payload: Dictionary, screen_global: Vector2) -> void:
	_drag_source = source
	_active_icon = null
	_drag_payload = payload.duplicate(true)
	_drag_start_map_global = screen_global
	_spawn_preview_from_payload(payload)
	_position_preview(screen_global)
	_drag_active = true
	set_process_unhandled_input(true)


func _update_drag(screen_global: Vector2) -> void:
	_position_preview(screen_global)
	if _drag_source == DragSource.MAP_ICON and _active_icon:
		_update_movement_arrow(_drag_start_map_global, screen_global)
		_highlight_hover(screen_global, _active_icon.source_region_id)


func _end_drag(screen_global: Vector2) -> void:
	var from_region := ""
	if _active_icon:
		from_region = _active_icon.source_region_id

	match _drag_source:
		DragSource.MAP_ICON:
			_finish_map_drop(from_region, screen_global)
		DragSource.MOBILIZE_UI:
			mobilize_drop_requested.emit(_drag_payload, screen_global)
		DragSource.COMBAT_UI:
			push_warning("DragController: combat UI drop not wired yet")

	_cleanup_drag()


func _cancel_drag() -> void:
	if _active_icon and is_instance_valid(_active_icon):
		_active_icon.clear_drag_state()
	_restore_source_icon()
	_cleanup_drag()
	drag_cancelled.emit()


func _finish_map_drop(from_region: String, screen_global: Vector2) -> void:
	var to_region := region_at_screen_global(screen_global)
	_restore_source_icon()
	if from_region.is_empty() or to_region.is_empty() or to_region == from_region:
		return
	var neighbors: Array = _adjacency.get(from_region, [])
	if to_region not in neighbors:
		return
	if _active_icon == null:
		return
	movement_drop_requested.emit(from_region, to_region, _active_icon.unit_type_id, 1)


func _cleanup_drag() -> void:
	_clear_preview()
	_hide_movement_arrow()
	_clear_highlights()
	_active_icon = null
	_drag_payload.clear()
	_hover_region = ""
	_drag_active = false
	set_process_unhandled_input(false)


func _store_original_transform(icon: UnitIcon) -> void:
	_original_parent = icon.get_parent()
	_original_position = icon.position
	_original_z_index = icon.z_index
	_original_visible = icon.visible


func _restore_source_icon() -> void:
	if _active_icon == null or not is_instance_valid(_active_icon):
		return
	_active_icon.visible = _original_visible
	_active_icon.set_selected(false)
	if _original_parent and is_instance_valid(_original_parent):
		if _active_icon.get_parent() != _original_parent:
			var current_parent := _active_icon.get_parent()
			if current_parent:
				current_parent.remove_child(_active_icon)
			_original_parent.add_child(_active_icon)
		_active_icon.position = _original_position
		_active_icon.z_index = _original_z_index


func _spawn_preview_from_icon(icon: UnitIcon) -> void:
	_preview_icon = _instantiate_preview()
	if _preview_icon == null:
		return
	_preview_icon.configure(icon.unit_type_id, icon.faction_id, icon.stack_count)
	_preview_icon.source_region_id = icon.source_region_id
	_add_preview_to_container()


func _spawn_preview_from_payload(payload: Dictionary) -> void:
	_preview_icon = _instantiate_preview()
	if _preview_icon == null:
		return
	var unit_type := str(payload.get("unit_type_id", ""))
	var faction := str(payload.get("faction_id", _payload_faction(payload)))
	_preview_icon.configure(unit_type, faction, int(payload.get("count", 1)))
	_add_preview_to_container()


func _instantiate_preview() -> UnitIcon:
	var scene := _unit_icon_scene
	if scene == null and _unit_visualizer:
		scene = _unit_visualizer.unit_icon_scene
	if scene == null:
		push_error("DragController: no unit_icon_scene for preview")
		return null
	var icon := scene.instantiate() as UnitIcon
	if icon == null:
		push_error("DragController: failed to instantiate UnitIcon preview")
	return icon


func _add_preview_to_container() -> void:
	if _preview_icon == null or drag_icon_container == null:
		return
	drag_icon_container.add_child(_preview_icon)
	_preview_icon.scale = UnitIcon.ICON_DISPLAY_SCALE
	_preview_icon.visible = true
	_preview_icon.set_selected(true)
	if _preview_icon.drag_area:
		_preview_icon.drag_area.input_pickable = false


func _clear_preview() -> void:
	if _preview_icon and is_instance_valid(_preview_icon):
		_preview_icon.queue_free()
	_preview_icon = null


func _position_preview(screen_global: Vector2) -> void:
	if _preview_icon == null or drag_icon_container == null:
		return
	_preview_icon.position = drag_icon_container.get_global_transform_with_canvas().affine_inverse() * screen_global


func screen_to_map_global(screen_global: Vector2) -> Vector2:
	if _map_root == null:
		return screen_global
	return _map_root.get_global_transform_with_canvas().affine_inverse() * screen_global


func region_at_screen_global(screen_global: Vector2) -> String:
	if _map_root and _map_root.has_method("_region_id_at_position"):
		return str(_map_root.call("_region_id_at_position", screen_global))
	return ""


func _show_movement_arrow(map_start: Vector2, screen_end: Vector2) -> void:
	if _movement_arrow == null or _unit_visualizer == null:
		return
	_movement_arrow.visible = true
	_update_movement_arrow(map_start, screen_end)


func _update_movement_arrow(map_start: Vector2, screen_end: Vector2) -> void:
	if _movement_arrow == null or _unit_visualizer == null:
		return
	var start_local := _unit_visualizer.to_local(map_start)
	var end_local := _unit_visualizer.to_local(screen_end)
	_movement_arrow.points = PackedVector2Array([start_local, end_local])


func _hide_movement_arrow() -> void:
	if _movement_arrow:
		_movement_arrow.visible = false
		_movement_arrow.points = PackedVector2Array()


func _highlight_hover(screen_global: Vector2, from_region: String) -> void:
	var hover := region_at_screen_global(screen_global)
	if hover == _hover_region:
		return
	_hover_region = hover
	if _map_root and _map_root.has_method("highlight_movement_targets"):
		_map_root.call("highlight_movement_targets", from_region, _adjacency, hover)


func _clear_highlights() -> void:
	if _map_root and _map_root.has_method("clear_movement_highlights"):
		_map_root.call("clear_movement_highlights", _last_snapshot)


func _payload_faction(payload: Dictionary) -> String:
	return str(payload.get("faction_id", payload.get("player_id", "")))


func _unhandled_input(event: InputEvent) -> void:
	if not _drag_active:
		return
	if event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE:
		_cancel_drag()
	elif event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_RIGHT:
		_cancel_drag()
