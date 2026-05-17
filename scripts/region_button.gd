extends Button
class_name RegionButton

signal region_pressed(region_id: String)

@export var region_id: String = ""
var highlighted: bool = false


func _ready() -> void:
	var cb := Callable(self, "_on_pressed")
	if not is_connected("pressed", cb):
		pressed.connect(cb)


func _on_pressed() -> void:
	print("RegionButton pressed:", name, "region_id:", region_id)
	region_pressed.emit(region_id)


func set_highlight(value: bool) -> void:
	highlighted = value
	print("HIGHLIGHT: %s -> %s" % [region_id, str(value)])
	if highlighted:
		modulate = Color(1.0, 1.0, 0.5, 1.0)
	else:
		modulate = Color(1.0, 1.0, 1.0, 1.0)


func get_highlight() -> bool:
	return highlighted
