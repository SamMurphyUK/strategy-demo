extends Control
class_name InspectorUnitChip

signal chip_pressed(entry: Dictionary)
signal chip_hovered(entry: Dictionary, anchor_global: Vector2)
signal chip_unhovered()

var unit_type_id: String = ""
var faction_id: String = ""
var stack_count: int = 1
var instance_id: String = ""
var region_id: String = ""
var is_container: bool = false

var _icon: TextureRect
var _count_label: Label
var _built: bool = false


func _ready() -> void:
	_ensure_built()


func _ensure_built() -> void:
	if _built:
		return
	_built = true
	custom_minimum_size = Vector2(UnitIcon.UNIT_ICON_SIZE + 8, UnitIcon.UNIT_ICON_SIZE + 20)
	size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	mouse_filter = Control.MOUSE_FILTER_STOP
	mouse_entered.connect(_on_mouse_entered)
	mouse_exited.connect(_on_mouse_exited)

	_icon = TextureRect.new()
	_icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_icon.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	_icon.custom_minimum_size = Vector2(UnitIcon.UNIT_ICON_SIZE, UnitIcon.UNIT_ICON_SIZE)
	_icon.size = Vector2(UnitIcon.UNIT_ICON_SIZE, UnitIcon.UNIT_ICON_SIZE)
	_icon.position = Vector2(4, 0)
	_icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_icon)

	_count_label = Label.new()
	_count_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_count_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_count_label.add_theme_font_size_override("font_size", 12)
	_count_label.position = Vector2(0, UnitIcon.UNIT_ICON_SIZE + 2)
	_count_label.size = Vector2(custom_minimum_size.x, 16)
	add_child(_count_label)


func configure(entry: Dictionary, p_region_id: String, container_unit: bool = false) -> void:
	_ensure_built()
	unit_type_id = str(entry.get("unit_type_id", ""))
	faction_id = str(entry.get("faction_id", ""))
	stack_count = int(entry.get("count", 1))
	instance_id = str(entry.get("instance_id", ""))
	region_id = p_region_id
	is_container = container_unit
	var tex := UnitTextureCache.get_texture(unit_type_id, faction_id)
	_icon.texture = tex
	_count_label.text = "× %d" % maxi(1, stack_count)


func get_entry() -> Dictionary:
	var entry := {
		"unit_type_id": unit_type_id,
		"faction_id": faction_id,
		"count": stack_count,
		"region_id": region_id,
	}
	if not instance_id.is_empty():
		entry["instance_id"] = instance_id
	return entry


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		chip_pressed.emit(get_entry())
		accept_event()


func _on_mouse_entered() -> void:
	if is_container and not instance_id.is_empty():
		chip_hovered.emit(get_entry(), get_global_rect().get_center())


func _on_mouse_exited() -> void:
	chip_unhovered.emit()
