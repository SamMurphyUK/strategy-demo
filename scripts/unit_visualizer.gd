extends Node2D
class_name UnitVisualizer

@export var unit_icon_scene: PackedScene = null
@export var debug_logging: bool = false

var _icons := {}

var UNIT_TEXTURES := {
	"infantry": {
		"allies": "res://textures/units/allies_infantry.png",
		"axis": "res://textures/units/axis_infantry.png",
	},
	"tank": {
		"allies": "res://textures/units/allies_tank.png",
		"axis": "res://textures/units/axis_tank.png",
	},
	"artillery": {
		"allies": "res://textures/units/allies_artillery.png",
		"axis": "res://textures/units/axis_artillery.png",
	},
}

func _ready() -> void:
	if debug_logging:
		print("UnitVisualizer ready. unit_icon_scene set:", unit_icon_scene != null)

func refresh_from_snapshot(snapshot: Dictionary, map_root: Node2D) -> void:
	_clear_all()
	for region_entry in snapshot.get("regions", []):
		var region_id := str(region_entry.get("region_id", ""))
		var units = region_entry.get("units", [])
		if units == null or units.is_empty():
			continue
		var grouped := {}
		for u in units:
			var t := str(u.get("unit_type_id", ""))
			var c := int(u.get("count", 0))
			grouped[t] = grouped.get(t, 0) + c
		for type_id in grouped.keys():
			_spawn_icon(region_id, type_id, int(grouped[type_id]), map_root)

func _spawn_icon(region_id: String, type_id: String, count: int, map_root: Node2D) -> void:
	var region_node := _find_region_node(region_id, map_root)
	if region_node == null:
		return
	var poly := region_node.get_node_or_null("Polygon2D")
	if poly == null:
		return
	var centroid := _polygon_centroid(poly.polygon)
	var global_pos := region_node.to_global(centroid)
	var local_pos := to_local(global_pos)
	var icon: Node2D = null
	if unit_icon_scene != null:
		icon = unit_icon_scene.instantiate() as Node2D
	if icon == null:
		icon = Node2D.new()
		var placeholder := Polygon2D.new()
		placeholder.polygon = PackedVector2Array([Vector2(-8, -8), Vector2(8, -8), Vector2(8, 8), Vector2(-8, 8)])
		placeholder.color = Color(1, 0.6, 0.0, 0.9)
		icon.add_child(placeholder)
	icon.position = local_pos
	var faction := "neutral"
	var meta := region_node.get_node_or_null("RegionMetadata")
	if meta:
		faction = str(meta.faction).to_lower()
	var tex: Texture2D = _load_unit_texture(type_id, faction)
	if icon.has_method("set_icon"):
		icon.call("set_icon", tex, count, faction)
	else:
		var label := icon.get_node_or_null("CountLabel")
		if label:
			label.text = str(count)
	if icon.has_method("set_faction_color"):
		icon.call("set_faction_color", faction)
	add_child(icon)
	if not _icons.has(region_id):
		_icons[region_id] = {}
	_icons[region_id][type_id] = icon

func _load_unit_texture(unit_type_id: String, faction: String) -> Texture2D:
	var path := str(UNIT_TEXTURES.get(unit_type_id, {}).get(faction, ""))
	if path != "" and ResourceLoader.exists(path):
		return load(path)
	var fallback := "res://texture/units/Copilot_20260521_020052.png"
	if ResourceLoader.exists(fallback):
		return load(fallback)
	return null

func _find_region_node(region_id: String, map_root: Node2D) -> Node2D:
	if map_root == null:
		return null
	var rl := map_root.get_node_or_null("RegionLayer")
	if rl == null:
		return null
	for r in rl.get_children():
		if str(r.name) == region_id:
			return r
		var meta := r.get_node_or_null("RegionMetadata")
		if meta and str(meta.region_id) == region_id:
			return r
	return null

func _polygon_centroid(points: PackedVector2Array) -> Vector2:
	if points == null or points.is_empty():
		return Vector2.ZERO
	var sum := Vector2.ZERO
	for p in points:
		sum += p
	return sum / points.size()

func _clear_all() -> void:
	for region_id in _icons.keys():
		for type_id in _icons[region_id].keys():
			var icon = _icons[region_id][type_id]
			if icon and is_instance_valid(icon):
				icon.queue_free()
	_icons.clear()
