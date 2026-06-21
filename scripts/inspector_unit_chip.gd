extends Control
class_name InspectorUnitChip

var _icon: TextureRect
var _count_label: Label


func _ready() -> void:
	custom_minimum_size = Vector2(UnitIcon.UNIT_ICON_SIZE + 8, UnitIcon.UNIT_ICON_SIZE + 20)
	size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	mouse_filter = Control.MOUSE_FILTER_IGNORE

	_icon = TextureRect.new()
	_icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_icon.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	_icon.custom_minimum_size = Vector2(UnitIcon.UNIT_ICON_SIZE, UnitIcon.UNIT_ICON_SIZE)
	_icon.size = Vector2(UnitIcon.UNIT_ICON_SIZE, UnitIcon.UNIT_ICON_SIZE)
	_icon.position = Vector2(4, 0)
	add_child(_icon)

	_count_label = Label.new()
	_count_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_count_label.add_theme_font_size_override("font_size", 12)
	_count_label.position = Vector2(0, UnitIcon.UNIT_ICON_SIZE + 2)
	_count_label.size = Vector2(custom_minimum_size.x, 16)
	add_child(_count_label)


func configure(unit_type_id: String, faction_id: String, count: int) -> void:
	if _icon == null:
		_ready()
	var tex := UnitTextureCache.get_texture(unit_type_id, faction_id)
	_icon.texture = tex
	var display_count := maxi(1, count)
	_count_label.text = "× %d" % display_count
