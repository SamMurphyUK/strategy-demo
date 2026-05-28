extends Node2D

@export var icon_sprite: Sprite2D
@export var count_label: Label

func _ready() -> void:
	if icon_sprite == null:
		icon_sprite = get_node_or_null("IconSprite")
	if count_label == null:
		count_label = get_node_or_null("CountLabel")

func set_icon(texture: Texture2D, count: int, faction: String) -> void:
	if icon_sprite and texture:
		icon_sprite.texture = texture
	if count_label:
		count_label.text = str(count)
	match faction.to_lower():
		"allies":
			modulate = Color(0.9, 1.0, 0.9)
		"axis":
			modulate = Color(1.0, 0.9, 0.9)
		_:
			modulate = Color(1, 1, 1)
