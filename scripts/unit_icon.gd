extends Node2D
class_name UnitIcon

@onready var sprite: Sprite2D = $Sprite
@onready var label: Label = $CountLabel
@onready var tint: ColorRect = $FactionTint

var unit_type_id: String = ""
var faction: String = ""

func set_count(n: int) -> void:
	if label:
		label.text = str(n)

func set_unit_type(t: String) -> void:
	unit_type_id = t

func set_faction_color(faction_name: String) -> void:
	faction = faction_name.to_lower()

	match faction:
		"allies":
			tint.color = Color(0.2, 0.4, 0.9, 0.25)
		"axis":
			tint.color = Color(0.9, 0.2, 0.2, 0.25)
		"independent":
			tint.color = Color(0.2, 0.8, 0.2, 0.25)
		_:
			tint.color = Color(1, 1, 1, 0.15)
