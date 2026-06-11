extends Node2D
class_name UnitIcon

signal drag_started(unit_icon: UnitIcon)
signal drag_updated(unit_icon: UnitIcon, global_position: Vector2)
signal drag_ended(unit_icon: UnitIcon, global_position: Vector2)
signal drag_cancelled(unit_icon: UnitIcon)

@export var icon_sprite: Sprite2D
@export var count_label: Label
@export var faction_tint: ColorRect
@export var selection_outline: Line2D
@export var drag_area: Area2D

const ICON_DISPLAY_SCALE := Vector2(0.18, 0.18)
const HITBOX_SIZE := Vector2(48, 48)

var unit_type_id: String = ""
var faction_id: String = ""
var stack_count: int = 1
var source_region_id: String = ""
var _selected: bool = false
var _dragging: bool = false


func _ready() -> void:
	_autobind()
	_apply_display_scale()
	_update_count_label()
	_update_selection_outline()

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
		count_label = get_node_or_null("CountLabel") as Label

	if faction_tint == null:
		faction_tint = get_node_or_null("FactionTint") as ColorRect

	if selection_outline == null:
		selection_outline = get_node_or_null("SelectionOutline") as Line2D

	if drag_area == null:
		drag_area = get_node_or_null("DragArea") as Area2D


func reset_for_pool() -> void:
	unit_type_id = ""
	faction_id = ""
	stack_count = 1
	source_region_id = ""
	_selected = false
	_dragging = false
	visible = true
	modulate = Color.WHITE
	set_selected(false)

	if icon_sprite:
		icon_sprite.texture = null
		icon_sprite.modulate = Color.WHITE

	if faction_tint:
		faction_tint.visible = true


func configure(p_unit_type_id: String, p_faction_id: String, p_count: int = 1) -> void:
	unit_type_id = p_unit_type_id.to_lower()
	faction_id = p_faction_id.to_lower()
	stack_count = max(1, p_count)

	_update_count_label()
	_apply_texture()
	_apply_faction_tint()


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


func set_source_region(region_id: String) -> void:
	source_region_id = region_id


func get_z_layer() -> int:
	return UnitLayout.get_z_order(unit_type_id)


func _apply_texture() -> void:
	if icon_sprite == null or unit_type_id.is_empty():
		return

	print("[ICON] Applying texture for:", unit_type_id, "|", faction_id)
	var tex := UnitTextureCache.get_texture(unit_type_id, faction_id)

	if tex:
		icon_sprite.texture = tex
	else:
		push_warning("UnitIcon: missing texture for %s/%s" % [faction_id, unit_type_id])


func _apply_faction_tint() -> void:
	if faction_tint == null:
		return

	match faction_id:
		"allies", "american", "us":
			faction_tint.color = Color(0.4, 0.85, 0.4, 0.22)
		"axis", "ger", "germany":
			faction_tint.color = Color(0.75, 0.75, 0.75, 0.22)
		_:
			faction_tint.color = Color(1, 1, 1, 0.12)


func _apply_display_scale() -> void:
	scale = ICON_DISPLAY_SCALE

	# Resize DragArea hitbox to match scaled icon
	if drag_area:
		var shape := drag_area.get_node_or_null("CollisionShape2D")
		if shape and shape.shape is RectangleShape2D:
			shape.shape.size = HITBOX_SIZE / ICON_DISPLAY_SCALE


func _update_count_label() -> void:
	if count_label == null:
		return
	count_label.visible = stack_count > 1
	count_label.text = str(stack_count)


func _update_selection_outline() -> void:
	if selection_outline == null:
		return

	selection_outline.visible = _selected

	if _selected:
		selection_outline.default_color = Color(1, 1, 0.2, 0.95)
	else:
		selection_outline.default_color = Color(1, 1, 1, 0)


func _on_drag_area_input(_viewport: Node, event: InputEvent, _shape_idx: int) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			_dragging = true
			set_process_unhandled_input(true)
			set_selected(true)
			drag_started.emit(self)
		elif _dragging:
			_dragging = false
			set_process_unhandled_input(false)
			set_selected(false)
			drag_ended.emit(self, get_global_mouse_position())

	elif event is InputEventMouseMotion and _dragging:
		drag_updated.emit(self, get_global_mouse_position())


func _unhandled_input(event: InputEvent) -> void:
	if not _dragging:
		return

	if event is InputEventMouseButton and not event.pressed:
		if event.button_index == MOUSE_BUTTON_RIGHT:
			_cancel_drag()

	elif event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE:
		_cancel_drag()


func cancel_drag() -> void:
	if not _dragging:
		return

	_dragging = false
	set_process_unhandled_input(false)
	set_selected(false)
	drag_cancelled.emit(self)


func _cancel_drag() -> void:
	cancel_drag()
