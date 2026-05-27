extends Node2D
class_name UnitVisualizer

@export var unit_icon_scene: PackedScene
@export var debug_logging: bool = false

# region_id -> { unit_type_id -> Node2D }
var _icons := {}

func refresh_from_snapshot(snapshot: Dictionary, map_root: Node2D) -> void:
	_clear_all()

	var regions = snapshot.get("regions", [])
	for region_entry in regions:
		var region_id := str(region_entry.get("region_id", ""))
		var units = region_entry.get("units", [])

		if units.is_empty():
			continue

		# Group by unit_type_id
		var grouped := {}
		for u in units:
			var t := str(u.get("unit_type_id", ""))
			var c := int(u.get("count", 0))
			grouped[t] = grouped.get(t, 0) + c

		# Spawn one icon per type
		for type_id in grouped.keys():
			var count = grouped[type_id]
			_spawn_icon(region_id, type_id, count, map_root)

	if debug_logging:
		print("UnitVisualizer refreshed.")


func _spawn_icon(region_id: String, type_id: String, count: int, map_root: Node2D) -> void:
	if unit_icon_scene == null:
		push_error("UnitVisualizer: unit_icon_scene not set.")
		return

	var region_node := _find_region_node(region_id, map_root)
	if region_node == null:
		return

	var poly := region_node.get_node_or_null("Polygon2D")
	if poly == null:
		return

	var centroid := _polygon_centroid(poly.polygon)

	var icon := unit_icon_scene.instantiate() as Node2D
	icon.position = centroid

	# Optional: tint by faction
	var meta := region_node.get_node_or_null("RegionMetadata")
	if meta and icon.has_method("set_faction_color"):
		icon.set_faction_color(str(meta.faction))

	# Set label
	var label := icon.get_node_or_null("CountLabel")
	if label:
		label.text = str(count)

	add_child(icon)

	# Track it
	if not _icons.has(region_id):
		_icons[region_id] = {}
	_icons[region_id][type_id] = icon


func _find_region_node(region_id: String, map_root: Node2D) -> Node2D:
	var rl := map_root.get_node_or_null("RegionLayer")
	if rl == null:
		return null

	for r in rl.get_children():
		var meta := r.get_node_or_null("RegionMetadata")
		if meta and str(meta.region_id) == region_id:
			return r
	return null


func _polygon_centroid(points: Array) -> Vector2:
	if points.is_empty():
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
