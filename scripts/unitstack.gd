extends Control
class_name UnitStack

signal stack_drag_started(from_region: String, unit_type_id: String, count: int)

@export var region_id: String = ""
@export var faction_id: String = ""
@export var unit_type_id: String = ""
@export var count: int = 1

@onready var icon: TextureRect = $Icon
@onready var count_label: Label = $CountLabel


func setup(p_region_id: String, p_faction_id: String, p_unit_type_id: String, p_count: int) -> void:
	region_id = p_region_id
	faction_id = p_faction_id
	unit_type_id = p_unit_type_id
	count = p_count
	_update_visual()


func _update_visual() -> void:
	if count_label:
		count_label.text = str(count) if count > 1 else ""
	# icon.texture should be assigned by HUD or a UnitArt service


func _get_drag_data(at_position: Vector2) -> Variant:
	var payload: Dictionary = {
		"from_region": region_id,
		"unit_type_id": unit_type_id,
		"faction_id": faction_id,
		"count": count
	}

	stack_drag_started.emit(region_id, unit_type_id, count)
	set_drag_preview(_create_drag_preview())
	return payload


func _create_drag_preview() -> Control:
	var preview := TextureRect.new()
	if icon:
		preview.texture = icon.texture
	preview.custom_minimum_size = Vector2(32, 32)
	preview.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return preview
