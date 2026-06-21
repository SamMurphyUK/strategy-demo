extends Node2D
class_name UnitIcon

signal drag_started(unit_icon: UnitIcon)
signal drag_updated(unit_icon: UnitIcon, global_position: Vector2)
signal drag_ended(unit_icon: UnitIcon, global_position: Vector2)
signal drag_cancelled(unit_icon: UnitIcon)
signal unit_clicked(unit_icon: UnitIcon)

@export var icon_sprite: Sprite2D
@export var count_label: Label
@export var count_badge: Panel
@export var faction_tint: ColorRect
@export var selection_outline: Line2D
@export var unmoved_outline: Line2D
@export var drag_area: Area2D

const UNIT_ICON_SIZE := 48
const CLICK_DRAG_THRESHOLD := 8.0
const UNMOVED_OUTLINE_GAP := 3.0

var unit_type_id: String = ""
var faction_id: String = ""
var instance_id: String = ""
var stack_count: int = 1
var source_region_id: String = ""
var is_drag_preview: bool = false
var _selected: bool = false
var _inspector_highlight: bool = false
var _unmoved: bool = false
var _dragging: bool = false
var _pending_click: bool = false
var _press_screen_pos: Vector2 = Vector2.ZERO


func _ready() -> void:
	_autobind()
	if not unit_type_id.is_empty():
		_apply_texture()
		_apply_faction_tint()
	if not is_drag_preview:
		_apply_display_scale()
	_update_count_label()
	_update_selection_outline()

	if icon_sprite:
		icon_sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST

	if drag_area:
		drag_area.input_pickable = true
		if not drag_area.input_event.is_connected(_on_drag_area_input):
			drag_area.input_event.connect(_on_drag_area_input)


func _autobind() -> void:
	if icon_sprite == null:
		icon_sprite = get_node_or_null("IconSprite") as Sprite2D
	if icon_sprite == null:
		icon_sprite = get_node_or_null("Sprite") as Sprite2D

	if count_label == null:
		count_label = get_node_or_null("CountBadge/CountLabel") as Label
	if count_label == null:
		count_label = get_node_or_null("CountLabel") as Label

	if count_badge == null:
		count_badge = get_node_or_null("CountBadge") as Panel

	if faction_tint == null:
		faction_tint = get_node_or_null("FactionTint") as ColorRect

	if selection_outline == null:
		selection_outline = get_node_or_null("SelectionOutline") as Line2D

	if unmoved_outline == null:
		unmoved_outline = get_node_or_null("UnmovedOutline") as Line2D

	if drag_area == null:
		drag_area = get_node_or_null("DragArea") as Area2D


func reset_for_pool() -> void:
	unit_type_id = ""
	faction_id = ""
	instance_id = ""
	stack_count = 1
	source_region_id = ""
	_selected = false
	_inspector_highlight = false
	_unmoved = false
	_dragging = false
	_pending_click = false
	is_drag_preview = false
	visible = true
	modulate = Color.WHITE
	scale = Vector2.ONE
	set_selected(false)
	set_unmoved_indicator(false)

	if icon_sprite:
		icon_sprite.texture = null
		icon_sprite.modulate = Color.WHITE

	if faction_tint:
		faction_tint.visible = true


func set_instance_id(id: String) -> void:
	instance_id = id


func configure(p_unit_type_id: String, p_faction_id: String, p_count: int = 1) -> void:
	_autobind()
	unit_type_id = p_unit_type_id.to_lower()
	faction_id = p_faction_id.to_lower()
	stack_count = max(1, p_count)

	_update_count_label()
	_apply_texture()
	_apply_faction_tint()
	_apply_icon_role()


func set_unit_type(type: String) -> void:
	unit_type_id = type.to_lower()
	if not faction_id.is_empty():
		_apply_texture()


func set_faction(faction: String) -> void:
	faction_id = faction.to_lower()
	if not unit_type_id.is_empty():
		_apply_texture()
	_apply_faction_tint()


func set_count(count: int) -> void:
	stack_count = max(0, count)
	_update_count_label()


func set_selected(is_selected: bool) -> void:
	_selected = is_selected
	_update_selection_outline()


func set_inspector_highlight(is_highlighted: bool) -> void:
	_inspector_highlight = is_highlighted
	_update_selection_outline()


func set_unmoved_indicator(show_indicator: bool) -> void:
	_unmoved = show_indicator
	_update_unmoved_outline()


func set_source_region(region_id: String) -> void:
	source_region_id = region_id


func get_z_layer() -> int:
	return UnitLayout.get_z_order(unit_type_id)


func get_texture_base_scale() -> float:
	if icon_sprite == null or icon_sprite.texture == null:
		return 1.0
	var w := float(icon_sprite.texture.get_width())
	if w <= 0.0:
		return 1.0
	return UnitIcon.UNIT_ICON_SIZE / w


func _apply_texture() -> void:
	if icon_sprite == null or unit_type_id.is_empty():
		return

	var tex := UnitTextureCache.get_texture(unit_type_id, faction_id)

	if tex:
		icon_sprite.texture = tex
		icon_sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		if not is_drag_preview:
			_apply_display_scale()
	else:
		push_warning("UnitIcon: missing texture for %s/%s" % [faction_id, unit_type_id])


func _apply_faction_tint() -> void:
	if faction_tint == null:
		return

	if unit_type_id == "factory":
		faction_tint.visible = false
		return

	faction_tint.visible = true
	match faction_id:
		"allies", "american", "us":
			faction_tint.color = Color(0.4, 0.85, 0.4, 0.22)
		"axis", "ger", "germany":
			faction_tint.color = Color(0.75, 0.75, 0.75, 0.22)
		_:
			faction_tint.color = Color(1, 1, 1, 0.12)


func _apply_icon_role() -> void:
	var is_factory := unit_type_id == "factory"
	var show_count := not is_factory and stack_count > 1
	if count_badge:
		count_badge.visible = show_count
	if count_label:
		count_label.visible = show_count
	if drag_area:
		drag_area.input_pickable = not is_factory and not is_drag_preview


func _apply_display_scale() -> void:
	if is_drag_preview:
		return
	var tex := icon_sprite.texture if icon_sprite else null
	if tex:
		var w := float(tex.get_width())
		if w > 0.0:
			scale = Vector2(UNIT_ICON_SIZE / w, UNIT_ICON_SIZE / w)
			if drag_area:
				var shape := drag_area.get_node_or_null("CollisionShape2D")
				if shape and shape.shape is RectangleShape2D:
					shape.shape.size = Vector2(w, w)


func _update_count_label() -> void:
	if count_label == null:
		return
	if unit_type_id == "factory":
		if count_badge:
			count_badge.visible = false
		count_label.visible = false
		return
	var show_count := stack_count > 1
	if count_badge:
		count_badge.visible = show_count
	count_label.visible = show_count
	count_label.text = str(stack_count)


func _update_selection_outline() -> void:
	if selection_outline == null:
		return

	if _inspector_highlight:
		selection_outline.visible = true
		selection_outline.default_color = Color(1.0, 1.0, 0.35, 0.5)
	elif _selected:
		selection_outline.visible = true
		selection_outline.default_color = Color(1, 1, 0.2, 0.95)
	else:
		selection_outline.visible = false
		selection_outline.default_color = Color(1, 1, 1, 0)


func _update_unmoved_outline() -> void:
	if unmoved_outline == null:
		return
	unmoved_outline.visible = _unmoved and not _dragging
	if not unmoved_outline.visible:
		return
	var half_icon := UNIT_ICON_SIZE * 0.5
	var outer := half_icon + UNMOVED_OUTLINE_GAP
	unmoved_outline.points = PackedVector2Array([
		Vector2(-outer, -outer),
		Vector2(outer, -outer),
		Vector2(outer, outer),
		Vector2(-outer, outer),
		Vector2(-outer, -outer),
	])
	unmoved_outline.width = 3.0
	unmoved_outline.default_color = Color(1, 1, 1, 0.95)


func _on_drag_area_input(_viewport: Node, event: InputEvent, _shape_idx: int) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			_pending_click = true
			_press_screen_pos = event.position
			set_process_unhandled_input(true)
		elif _pending_click and not _dragging:
			_pending_click = false
			set_process_unhandled_input(false)
			get_viewport().set_input_as_handled()
			unit_clicked.emit(self)
		elif _dragging:
			_finish_drag(event.global_position)

	elif event is InputEventMouseMotion:
		if _pending_click and not _dragging:
			if event.position.distance_to(_press_screen_pos) >= CLICK_DRAG_THRESHOLD:
				_start_drag()
		if _dragging:
			drag_updated.emit(self, event.global_position)


func _start_drag() -> void:
	_pending_click = false
	_dragging = true
	get_viewport().set_input_as_handled()
	set_unmoved_indicator(false)
	set_selected(true)
	drag_started.emit(self)


func _finish_drag(global_pos: Vector2) -> void:
	_dragging = false
	set_process_unhandled_input(false)
	set_selected(false)
	set_unmoved_indicator(_unmoved)
	drag_ended.emit(self, global_pos)


func _unhandled_input(event: InputEvent) -> void:
	if not _dragging and not _pending_click:
		return

	if event is InputEventMouseButton and not event.pressed:
		if event.button_index == MOUSE_BUTTON_RIGHT:
			if _pending_click:
				_pending_click = false
				set_process_unhandled_input(false)
			else:
				_cancel_drag()

	elif event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE:
		if _pending_click:
			_pending_click = false
			set_process_unhandled_input(false)
		else:
			_cancel_drag()


func cancel_drag() -> void:
	if not _dragging:
		return
	clear_drag_state()
	drag_cancelled.emit(self)


func clear_drag_state() -> void:
	_dragging = false
	_pending_click = false
	set_process_unhandled_input(false)
	set_selected(false)
	set_unmoved_indicator(_unmoved)


func _cancel_drag() -> void:
	cancel_drag()
