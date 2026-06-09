extends Node2D

@export var icon_sprite: Sprite2D
@export var count_label: Label

var faction_id: String = ""
var unit_type_id: String = ""

func _ready() -> void:
	if icon_sprite == null:
		icon_sprite = get_node_or_null("Sprite")
	if icon_sprite == null:
		icon_sprite = get_node_or_null("IconSprite")
	if count_label == null:
		count_label = get_node_or_null("CountLabel")

func set_icon(texture: Texture2D, count: int, faction: String) -> void:
	if icon_sprite and texture:
		icon_sprite.texture = texture
	if count_label:
		count_label.text = str(count)
	if icon_sprite:
		match faction.to_lower():
			"allies":
				icon_sprite.modulate = Color(0.8, 1.0, 0.8)
			"axis":
				icon_sprite.modulate = Color(1.0, 0.8, 0.8)
			_:
				icon_sprite.modulate = Color(1, 1, 1)

func set_faction_color(faction_name: String) -> void:
	if icon_sprite == null:
		icon_sprite = get_node_or_null("Sprite")
	if icon_sprite == null:
		return
	match faction_name.to_lower():
		"allies":
			icon_sprite.modulate = Color(0.8, 1.0, 0.8)
		"axis":
			icon_sprite.modulate = Color(1.0, 0.8, 0.8)
		_:
			icon_sprite.modulate = Color(1, 1, 1)

func set_count(n: int) -> void:
	if count_label:
		count_label.text = str(n)

func load_texture() -> void:
	var sprite := get_node_or_null("Sprite") as Sprite2D
	if sprite == null:
		return

	var paths := [
		"res://texture/units/%s_%s.png" % [faction_id, unit_type_id],
		"res://texture/units/%s.png" % unit_type_id,
		"res://texture/units/default.png"
	]

	for p in paths:
		if ResourceLoader.exists(p):
			sprite.texture = load(p)
			return

	push_warning("UnitIcon: No texture found for %s/%s" % [faction_id, unit_type_id])
