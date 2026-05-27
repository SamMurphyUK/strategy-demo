extends Node2D
class_name RegionMarkers

@export var region_positions: Dictionary = {
	"red_capital": Vector2(200, 300),
	"red_front": Vector2(350, 300),
	"blue_front": Vector2(500, 300),
	"blue_capital": Vector2(650, 300),
	"sea_west": Vector2(275, 450),
	"sea_east": Vector2(575, 450),
}


func _ready() -> void:
	for region_id in region_positions.keys():
		var pos: Vector2 = region_positions[region_id]
		_add_marker(str(region_id), pos)


func _add_marker(region_id: String, pos: Vector2) -> void:
	var marker := ColorRect.new()
	marker.name = "Marker_%s" % region_id
	marker.color = Color(0.2, 0.2, 0.25, 0.35)
	marker.size = Vector2(120, 80)
	marker.position = pos - marker.size * 0.5
	add_child(marker)

	var label := Label.new()
	label.text = region_id
	label.position = Vector2(-40, -50)
	label.add_theme_font_size_override("font_size", 11)
	marker.add_child(label)
