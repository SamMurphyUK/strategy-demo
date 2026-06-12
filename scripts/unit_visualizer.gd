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
var _drag_controller = null  # DragController
var _current_zoom := 1.0


func _ready() -> void:
	_ensure_unit_icon_scene()
	_movement_arrow = Line2D.new()
	_movement_arrow.width = 3.0
	_movement_arrow.default_color = Color(1, 0.9, 0.2, 0.9)
	_movement_arrow.visible = false
	_movement_arrow.z_index = UnitLayout.get_z_order("movement_arrow")
	add_child(_movement_arrow)


func set_drag_controller(controller) -> void:
	if _drag_controller == controller:
		return
	_drag_controller = controller
	if _drag_controller == null:
		return
	_drag_controller.configure(self, _map_root, _movement_arrow, unit_icon_scene)
	if not _drag_controller.movement_drop_requested.is_connected(_on_controller_movement_drop):
		_drag_controller.movement_drop_requested.connect(_on_controller_movement_drop)


func _ensure_unit_icon_scene() -> void:
	if unit_icon_scene != null:
		return
	var candidates := [
		"res://scenes/UnitIcon.tscn",
		"res://scenes/ui/UnitIcon.tscn",
	]
	for path in candidates:
		if ResourceLoader.exists(path):
			unit_icon_scene = load(path)
			return
	push_error("UnitVisualizer: failed to load unit_icon_scene")


func _load_unit_texture(unit_type_id: String, faction: String) -> Texture2D:
	return UnitTextureCache.get_texture(unit_type_id, faction)


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
	if _drag_controller:
		_drag_controller.configure(self, _map_root, _movement_arrow, unit_icon_scene)
		_drag_controller.set_context(_current_phase, _adjacency, _last_snapshot)
	refresh_all()


func refresh_all() -> void:
	if _drag_controller:
		_drag_controller.cancel_active_drag()
	clear_all_units()
	if _map_root == null or _last_snapshot.is_empty():
		return
	for region_entry in _last_snapshot.get("regions", []):
		if typeof(region_entry) != TYPE_DICTIONARY:
			continue
		var region_id := str(region_entry.get("region_id", ""))
		var grouped := _group_units(region_entry.get("units", []))
		update_region_units(region_id, grouped)
	apply_zoom_scale(_current_zoom)


func apply_zoom_scale(zoom: float) -> void:
	_current_zoom = maxf(zoom, 0.001)
	for region_id in _region_icons.keys():
		for icon in _region_icons[region_id]:
			_apply_icon_zoom_scale(icon)
	for region_id in _factory_icons.keys():
		_apply_icon_zoom_scale(_factory_icons[region_id])


func _apply_icon_zoom_scale(icon: UnitIcon) -> void:
	if icon == null or not is_instance_valid(icon):
		return
	var base_scale := icon.get_texture_base_scale()
	icon.scale = Vector2(base_scale / _current_zoom, base_scale / _current_zoom)


func clear_all_units() -> void:
	if _drag_controller:
		_drag_controller.cancel_active_drag()
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
		var faction_id := str(entry.get("faction_id", entry.get("faction", "neutral")))
		icon.configure(str(unit_type), faction_id, int(entry.get("count", 1)))
		icon.position = local_anchor + layout_slots[slot_idx]
		icon.z_index = icon.get_z_layer()
		icon.visible = true
		_connect_drag_signals(icon)
		add_child(icon)
		_apply_icon_zoom_scale(icon)
		icons_for_region.append(icon)
		slot_idx += 1

	_region_icons[region_id] = icons_for_region

	if meta.has_factory:
		var factory_icon := _acquire_icon()
		factory_icon.source_region_id = region_id
		var owner_faction := _owner_faction_for_region(region_id, meta)
		factory_icon.configure("factory", owner_faction, 1)
		factory_icon.position = local_anchor + UnitLayout.FACTORY_OFFSET
		factory_icon.z_index = UnitLayout.get_z_order("factory")
		factory_icon.visible = true
		add_child(factory_icon)
		_apply_icon_zoom_scale(factory_icon)
		_factory_icons[region_id] = factory_icon


func _group_units(units_array: Array) -> Dictionary:
	var grouped := {}
	for u in units_array:
		if typeof(u) != TYPE_DICTIONARY:
			continue
		var parsed := UnitTextureCache.normalize_unit_type_and_faction(
			str(u.get("unit_type_id", "")),
			str(u.get("faction_id", ""))
		)
		var unit_type := str(parsed["unit_type_id"])
		if unit_type.is_empty():
			continue
		var faction_id := str(parsed["faction_id"])
		var count := int(u.get("count", 0))
		if not grouped.has(unit_type):
			grouped[unit_type] = {"faction_id": faction_id, "count": 0}
		grouped[unit_type]["count"] = int(grouped[unit_type]["count"]) + count
	return grouped


func _acquire_icon() -> UnitIcon:
	while not _icon_pool.is_empty():
		var pooled: UnitIcon = _icon_pool.pop_back()
		if is_instance_valid(pooled):
			pooled.reset_for_pool()
			return pooled
	if unit_icon_scene == null:
		_ensure_unit_icon_scene()
	if unit_icon_scene == null:
		push_error("UnitVisualizer: unit_icon_scene is NULL inside _acquire_icon()")
		return null
	return unit_icon_scene.instantiate() as UnitIcon


func _release_icon(icon: UnitIcon) -> void:
	if icon == null or not is_instance_valid(icon):
		return
	_disconnect_drag_signals(icon)
	if icon.get_parent() == self:
		remove_child(icon)
	icon.reset_for_pool()
	_icon_pool.append(icon)


func _connect_drag_signals(icon: UnitIcon) -> void:
	if _drag_controller:
		_drag_controller.bind_map_icon(icon)


func _disconnect_drag_signals(icon: UnitIcon) -> void:
	if _drag_controller:
		_drag_controller.unbind_map_icon(icon)


func _on_controller_movement_drop(
	from_region_id: String,
	to_region_id: String,
	unit_type_id: String,
	count: int
) -> void:
	movement_drop_requested.emit(from_region_id, to_region_id, unit_type_id, count)


func _region_owner_faction(meta: RegionMetadata) -> String:
	return UnitTextureCache.normalize_faction_id(str(meta.faction))


func _owner_faction_for_region(region_id: String, meta: RegionMetadata) -> String:
	for region_entry in _last_snapshot.get("regions", []):
		if typeof(region_entry) != TYPE_DICTIONARY:
			continue
		if str(region_entry.get("region_id", "")) == region_id:
			var owner := str(region_entry.get("owner_faction_id", ""))
			if not owner.is_empty():
				return UnitTextureCache.normalize_faction_id(owner)
			break
	return _region_owner_faction(meta)


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
