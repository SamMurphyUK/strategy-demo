extends Node2D
class_name UnitVisualizer

signal movement_drop_requested(
	from_region_id: String,
	to_region_id: String,
	unit_type_id: String,
	count: int
)

@export var unit_icon_scene: PackedScene = null
@export var debug_logging: bool = false

var _map_root: Node2D = null
var _adjacency: Dictionary = {}
var _current_phase: String = ""
var _current_faction: String = ""
var _last_snapshot: Dictionary = {}

var _region_icons: Dictionary = {}
var _factory_icons: Dictionary = {}
var _icon_pool: Array = []
var _movement_arrow: Line2D = null
var _drag_icon: UnitIcon = null
var _drag_hover_region: String = ""


func _ready() -> void:
	if unit_icon_scene == null and ResourceLoader.exists("res://scenes/UnitIcon.tscn"):
		unit_icon_scene = load("res://scenes/UnitIcon.tscn")
	_movement_arrow = Line2D.new()
	_movement_arrow.width = 3.0
	_movement_arrow.default_color = Color(1, 0.9, 0.2, 0.9)
	_movement_arrow.visible = false
	_movement_arrow.z_index = UnitLayout.get_z_order("movement_arrow")
	add_child(_movement_arrow)
	set_process_unhandled_input(true)


# -------------------------------------------------------------------
# Unified texture loader (delegates to UnitTextureCache)
# -------------------------------------------------------------------
func _load_unit_texture(unit_type_id: String, faction: String) -> Texture2D:
	if debug_logging:
		print("[VIS] load_unit_texture:", unit_type_id, faction)
	return UnitTextureCache.get_texture(unit_type_id, faction)


# -------------------------------------------------------------------
# Snapshot refresh
# -------------------------------------------------------------------
func refresh_from_snapshot(
	snapshot: Dictionary,
	map_root: Node2D,
	adjacency: Dictionary = {},
	current_phase: String = "",
	current_faction: String = ""
) -> void:
	_last_snapshot = snapshot
	_map_root = map_root
	_adjacency = adjacency
	_current_phase = current_phase
	_current_faction = current_faction
	refresh_all()


func refresh_all() -> void:
	clear_all_units()
	if _map_root == null or _last_snapshot.is_empty():
		return
	for region_entry in _last_snapshot.get("regions", []):
		if typeof(region_entry) != TYPE_DICTIONARY:
			continue
		var region_id := str(region_entry.get("region_id", ""))
		var grouped := _group_units(region_entry.get("units", []))
		update_region_units(region_id, grouped)


func clear_all_units() -> void:
	_cancel_active_drag()
	for region_id in _region_icons.keys():
		for icon in _region_icons[region_id]:
			_release_icon(icon)
	for region_id in _factory_icons.keys():
		_release_icon(_factory_icons[region_id])
	_region_icons.clear()
	_factory_icons.clear()


func update_region_units(region_id: String, units: Dictionary) -> void:
	if _map_root == null:
		return
	var region_node := _find_region_node(region_id, _map_root)
	if region_node == null:
		return
	var meta := region_node.get_node_or_null("RegionMetadata") as RegionMetadata
	if meta == null:
		return

	if _region_icons.has(region_id):
		for icon in _region_icons[region_id]:
			_release_icon(icon)
		_region_icons[region_id] = []
	if _factory_icons.has(region_id):
		_release_icon(_factory_icons[region_id])
		_factory_icons.erase(region_id)

	var anchor: Vector2 = meta.unit_anchor
	var bounds: Rect2 = meta.unit_bounds
	var global_anchor := region_node.to_global(anchor)
	var local_anchor := to_local(global_anchor)

	var unit_types: Array = UnitLayout.sort_unit_types(units.keys())
	var layout_slots: Array[Vector2] = UnitLayout.layout_positions(unit_types.size())
	layout_slots = UnitLayout.clamp_positions_to_bounds(layout_slots, anchor, bounds)

	var icons_for_region: Array = []
	var slot_idx := 0
	for unit_type in unit_types:
		var entry: Dictionary = units[unit_type]
		var icon := _acquire_icon()
		icon.source_region_id = region_id
		icon.set_unit_type(str(unit_type))
		icon.set_faction(str(entry.get("faction", "neutral")))
		icon.set_count(int(entry.get("count", 1)))

		# ⭐ APPLY TEXTURE HERE
		var tex := _load_unit_texture(unit_type, entry.get("faction", "neutral"))
		if icon.icon_sprite:
			icon.icon_sprite.texture = tex

		icon.position = local_anchor + layout_slots[slot_idx]
		icon.z_index = icon.get_z_layer()
		icon.visible = true
		_connect_drag_signals(icon)
		add_child(icon)
		icons_for_region.append(icon)
		slot_idx += 1

	_region_icons[region_id] = icons_for_region

	# Factory icon
	if meta.has_factory:
		var factory_icon := _acquire_icon()
		factory_icon.source_region_id = region_id
		factory_icon.set_unit_type("factory")
		factory_icon.set_faction(_region_owner_faction(meta))
		factory_icon.set_count(1)

		# ⭐ APPLY FACTORY TEXTURE
		var ftex := _load_unit_texture("factory", _region_owner_faction(meta))
		if factory_icon.icon_sprite:
			factory_icon.icon_sprite.texture = ftex

		factory_icon.position = local_anchor + UnitLayout.FACTORY_OFFSET
		factory_icon.z_index = UnitLayout.get_z_order("factory")
		factory_icon.visible = true
		add_child(factory_icon)
		_factory_icons[region_id] = factory_icon


# -------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------
func _group_units(units_array: Array) -> Dictionary:
	var grouped := {}
	for u in units_array:
		if typeof(u) != TYPE_DICTIONARY:
			continue
		var unit_type := str(u.get("unit_type_id", ""))
		if unit_type.is_empty():
			continue
		var faction := str(u.get("faction_id", "neutral"))
		var count := int(u.get("count", 0))
		if not grouped.has(unit_type):
			grouped[unit_type] = {"faction": faction, "count": 0}
		grouped[unit_type]["count"] = int(grouped[unit_type]["count"]) + count
	return grouped


func _acquire_icon() -> UnitIcon:
	while not _icon_pool.is_empty():
		var pooled: UnitIcon = _icon_pool.pop_back()
		if is_instance_valid(pooled):
			pooled.reset_for_pool()
			return pooled
	var icon: UnitIcon = unit_icon_scene.instantiate() as UnitIcon
	return icon


func _release_icon(icon: UnitIcon) -> void:
	if icon == null or not is_instance_valid(icon):
		return
	_disconnect_drag_signals(icon)
	if icon.get_parent() == self:
		remove_child(icon)
	icon.reset_for_pool()
	_icon_pool.append(icon)


func _connect_drag_signals(icon: UnitIcon) -> void:
	if not icon.drag_started.is_connected(_on_icon_drag_started):
		icon.drag_started.connect(_on_icon_drag_started)
	if not icon.drag_updated.is_connected(_on_icon_drag_updated):
		icon.drag_updated.connect(_on_icon_drag_updated)
	if not icon.drag_ended.is_connected(_on_icon_drag_ended):
		icon.drag_ended.connect(_on_icon_drag_ended)
	if not icon.drag_cancelled.is_connected(_on_icon_drag_cancelled):
		icon.drag_cancelled.connect(_on_icon_drag_cancelled)


func _disconnect_drag_signals(icon: UnitIcon) -> void:
	if icon.drag_started.is_connected(_on_icon_drag_started):
		icon.drag_started.disconnect(_on_icon_drag_started)
	if icon.drag_updated.is_connected(_on_icon_drag_updated):
		icon.drag_updated.disconnect(_on_icon_drag_updated)
	if icon.drag_ended.is_connected(_on_icon_drag_ended):
		icon.drag_ended.disconnect(_on_icon_drag_ended)
	if icon.drag_cancelled.is_connected(_on_icon_drag_cancelled):
		icon.drag_cancelled.disconnect(_on_icon_drag_cancelled)


func _movement_phase_active() -> bool:
	return _current_phase in ["combat_move", "noncombat_move"]


func _on_icon_drag_started(icon: UnitIcon) -> void:
	if not _movement_phase_active():
		icon.set_selected(false)
		return
	_drag_icon = icon
	_drag_hover_region = ""
	_movement_arrow.visible = true
	if _map_root and _map_root.has_method("highlight_movement_targets"):
		_map_root.call("highlight_movement_targets", icon.source_region_id, _adjacency, "")


func _on_icon_drag_updated(icon: UnitIcon, global_pos: Vector2) -> void:
	if _drag_icon != icon:
		return
	var start_local := to_local(icon.global_position)
	var end_local := to_local(global_pos)
	_movement_arrow.points = PackedVector2Array([start_local, end_local])
	var hover := _region_at_global(global_pos)
	if hover != _drag_hover_region:
		_drag_hover_region = hover
		if _map_root and _map_root.has_method("highlight_movement_targets"):
			_map_root.call("highlight_movement_targets", icon.source_region_id, _adjacency, hover)


func _on_icon_drag_ended(icon: UnitIcon, global_pos: Vector2) -> void:
	if _drag_icon != icon:
		return
	var to_region: String = _region_at_global(global_pos)
	var from_region: String = icon.source_region_id
	_finish_drag()
	if to_region.is_empty() or to_region == from_region:
		return
	var neighbors: Array = _adjacency.get(from_region, [])
	if to_region not in neighbors:
		return
	movement_drop_requested.emit(from_region, to_region, icon.unit_type_id, 1)


func _on_icon_drag_cancelled(icon: UnitIcon) -> void:
	if _drag_icon == icon:
		_finish_drag()


func _finish_drag() -> void:
	_drag_icon = null
	_drag_hover_region = ""
	_movement_arrow.visible = false
	_movement_arrow.points = PackedVector2Array()
	if _map_root and _map_root.has_method("clear_movement_highlights"):
		_map_root.call("clear_movement_highlights", _last_snapshot)


func _cancel_active_drag() -> void:
	if _drag_icon and is_instance_valid(_drag_icon):
		_drag_icon.set_selected(false)
	_finish_drag()


func _unhandled_input(event: InputEvent) -> void:
	if _drag_icon == null:
		return
	if event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE:
		_drag_icon.cancel_drag()
	elif event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_RIGHT:
		_drag_icon.cancel_drag()


func _region_at_global(global_pos: Vector2) -> String:
	if _map_root and _map_root.has_method("_region_id_at_position"):
		return str(_map_root.call("_region_id_at_position", global_pos))
	return ""


func _region_owner_faction(meta: RegionMetadata) -> String:
	return str(meta.faction).to_lower()


func _find_region_node(region_id: String, map_root: Node2D) -> Node2D:
	if map_root == null:
		return null
	if map_root is GameMapRoot:
		var regions_dict: Dictionary = (map_root as GameMapRoot).regions
		if regions_dict.has(region_id):
			return regions_dict[region_id] as Node2D
	var rl := map_root.get_node_or_null("RegionLayer")
	if rl == null:
		return null
	return rl.get_node_or_null(region_id) as Node2D
