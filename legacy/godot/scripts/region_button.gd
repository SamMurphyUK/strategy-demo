extends Control
class_name RegionButtonNew

signal region_pressed(region_id: String)
signal units_dropped(from_region: String, to_region: String, unit_type_id: String, count: int)

@export var region_id: String = ""

@onready var stack_container: Control = $StackContainer
@onready var highlight: ColorRect = $Highlight
@onready var factory_icon: ColorRect = $FactoryIcon
@onready var victory_icon: ColorRect = $VictoryIcon
@onready var overflow_badge: Label = $OverflowBadge

var _highlighted: bool = false

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	if highlight:
		highlight.visible = false
	if factory_icon:
		factory_icon.visible = false
	if victory_icon:
		victory_icon.visible = false
	if overflow_badge:
		overflow_badge.visible = false
	print("RegionButtonNew ready:", region_id)

func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var mb: InputEventMouseButton = event
		if mb.pressed and mb.button_index == MOUSE_BUTTON_LEFT:
			emit_signal("region_pressed", region_id)

func _can_drop_data(at_position: Vector2, data: Variant) -> bool:
	if typeof(data) != TYPE_DICTIONARY:
		return false
	var payload: Dictionary = data
	return payload.has("from_region") and payload.has("unit_type_id")

func _drop_data(at_position: Vector2, data: Variant) -> void:
	if typeof(data) != TYPE_DICTIONARY:
		return
	var payload: Dictionary = data
	var from_region: String = str(payload.get("from_region", ""))
	var unit_type_id: String = str(payload.get("unit_type_id", ""))
	var drop_count: int = int(payload.get("count", 1))
	emit_signal("units_dropped", from_region, region_id, unit_type_id, drop_count)

func set_highlight(value: bool) -> void:
	_highlighted = value
	if highlight:
		highlight.visible = value

func get_highlight() -> bool:
	return _highlighted

func show_factory(value: bool) -> void:
	if factory_icon:
		factory_icon.visible = value

func show_victory(value: bool) -> void:
	if victory_icon:
		victory_icon.visible = value

func clear_unit_stacks() -> void:
	if stack_container == null:
		return
	for child in stack_container.get_children():
		child.queue_free()
	if overflow_badge:
		overflow_badge.visible = false

func add_unit_stack(stack: Node) -> void:
	if stack_container:
		stack_container.add_child(stack)
		print("RB clicked:", region_id)

func set_overflow(count: int) -> void:
	if overflow_badge:
		if count > 0:
			overflow_badge.text = "+%d" % count
			overflow_badge.visible = true
		else:
			overflow_badge.visible = false
