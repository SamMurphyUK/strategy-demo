extends Node2D
class_name UnitVisualizer

@export var unit_icon_scene: PackedScene = null
@export var debug_logging: bool = false

# region_id -> { unit_type_id -> Node2D }
var _icons := {}

func _ready() -> void:
	# Debug info so you can confirm inspector wiring
	print("UnitVisualizer ready. unit_icon_scene set:", unit_icon_scene != null, " parent:", get_parent())
	if debug_logging:
		print("UnitVisualizer: ready, will spawn icons when refresh_from_snapshot is called.")


func refresh_from_snapshot(snapshot: Dictionary, map_root: Node2D) -> void:
	_clear_all()

	var regions = snapshot.get("regions", [])
	for region_entry in regions:
		var region_id := str(region_entry.get("region_id", ""))
		var units = region_entry.get("units", [])

		if units == null or units.is_empty():
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
		print("UnitVisualizer refreshed. spawned icons for", _icons.keys())


func _spawn_icon(region_id: String, type_id: String, count: int, map_root: Node2D) -> void:
	# If no scene assigned, create a visible placeholder instead of failing
	var use_placeholder := false
	if unit_icon_scene == null:
		push_error("UnitVisualizer: unit_icon_scene not set. Using placeholder icon for region '%s'." % region_id)
		use_placeholder = true

	var region_node := _find_region_node(region_id, map_root)
	if region_node == null:
		if debug_logging:
			print("UnitVisualizer: region node not found for", region_id)
		return

	var poly := region_node.get_node_or_null("Polygon2D")
	if poly == null:
		if debug_logging:
			print("UnitVisualizer: Polygon2D missing for", region_id)
		return

	# centroid in region local coords
	var centroid := _polygon_centroid(poly.polygon)

	# Convert region local centroid -> global -> this Node2D local
	var global_pos := region_node.to_global(centroid)
	var local_pos := to_local(global_pos)

	var icon: Node2D = null
	if not use_placeholder:
		icon = unit_icon_scene.instantiate() as Node2D
		if icon == null:
			push_error("UnitVisualizer: failed to instantiate unit_icon_scene; using placeholder.")
			use_placeholder = true

	if use_placeholder:
		# simple square placeholder so you can see units without a scene
		var placeholder := Polygon2D.new()
		placeholder.polygon = PackedVector2Array([Vector2(-8, -8), Vector2(8, -8), Vector2(8, 8), Vector2(-8, 8)])
		placeholder.color = Color(1, 0.6, 0.0, 0.9)
		icon = Node2D.new()
		icon.add_child(placeholder)

	# position the icon relative to this UnitVisualizer node
	icon.position = local_pos

	# Optional: tint by faction if the icon supports it
	var meta := region_node.get_node_or_null("RegionMetadata")
	if meta and icon.has_method("set_faction_color"):
		icon.set_faction_color(str(meta.faction))

	# Set label if present
	var label := icon.get_node_or_null("CountLabel")
	if label:
		label.text = str(count)

	# Add to scene tree under UnitVisualizer (keeps icons in same CanvasLayer)
	add_child(icon)

	# Track it
	if not _icons.has(region_id):
		_icons[region_id] = {}
	_icons[region_id][type_id] = icon

	if debug_logging:
		print("UnitVisualizer: spawned icon for", region_id, type_id, "count", count, "pos", local_pos)


func _find_region_node(region_id: String, map_root: Node2D) -> Node2D:
	if map_root == null:
		return null
	var rl := map_root.get_node_or_null("RegionLayer")
	if rl == null:
		return null

	for r in rl.get_children():
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
