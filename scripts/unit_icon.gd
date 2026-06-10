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

	# 🔥 Try to bind DragArea if it exists
	var drag_area := get_node_or_null("DragArea")
	if drag_area:
		drag_area.input_pickable = true
		if not drag_area.input_event.is_connected(_on_drag_area_input):
			drag_area.input_event.connect(_on_drag_area_input)


# -------------------------------------------------------------------
# ⭐ DRAG INPUT HANDLER (added for debugging)
# -------------------------------------------------------------------
func _on_drag_area_input(_viewport: Node, event: InputEvent, _shape_idx: int) -> void:
	print("DRAG AREA INPUT:", event)   # ← DEBUG PRINT

	# This does NOT implement dragging yet — this is just to confirm input works.
	# Once this prints, we know the hitbox is alive and receiving events.


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

	var tex := UnitTextureCache.get_texture(unit_type_id, faction_id)
	if tex:
		sprite.texture = tex
		return

	push_warning("UnitIcon: No texture found for %s/%s" % [faction_id, unit_type_id])
