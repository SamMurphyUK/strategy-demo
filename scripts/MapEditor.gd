extends Node2D
class_name MapEditor

# -------------------------
# Core scene nodes
# -------------------------
@onready var map_root: Node2D = $MapRoot
@onready var base_map: Sprite2D = $MapRoot/BaseMap
@onready var region_layer: Node2D = $MapRoot/RegionLayer

# UI nodes
@onready var inspector: Node = $ToolLayer/UI/InspectorPanel
@onready var region_list: ItemList = $ToolLayer/UI/RegionList
@onready var ui_root: Control = $ToolLayer/UI

# Reusable dialogs
var _file_dialog: FileDialog = null

# Editor state
var current_region: Node2D = null
var drawing_points: Array = []
var is_drawing: bool = false
var preview_poly: Line2D = null
var pan_speed: float = 500.0

# Undo/Redo
var undo_stack: Array = []
var redo_stack: Array = []
const MAX_UNDO_STEPS: int = 50

# Region index for fast lookups
var _region_index: Array = []
var _region_id_set: Dictionary = {}
var _anchor_counter: int = 0
var _region_counter: int = 0

# Faction colors
var faction_colors: Dictionary = {
	"Neutral": Color(0.5, 0.5, 0.5, 0.4),
	"Allies": Color(0.2, 0.4, 0.8, 0.4),
	"Axis": Color(0.8, 0.2, 0.2, 0.4),
	"Independent": Color(0.2, 0.7, 0.2, 0.4),
	"": Color(1.0, 0.0, 0.0, 0.4)
}

# Batch edit mode
var batch_mode: bool = false
var batch_selected_regions: Array = []

# Autosave
var autosave_timer: Timer = null
var autosave_interval: float = 120.0
var autosave_enabled: bool = true
var last_save_path: String = "user://exported_map.json"

# Debug logging
var debug_logging: bool = false

# Signals
signal region_selected(region: Node2D)
signal region_created(region: Node2D)
signal region_deleted(region: Node2D)
signal map_saved(path: String)
signal map_loaded(path: String)


# -------------------------
# Helpers
# -------------------------
func _log(message: String) -> void:
	if debug_logging:
		print("[MapEditor] ", message)


# -------------------------
# Ready
# -------------------------
func _ready() -> void:
	print("MapEditor ready")

	# Setup reusable file dialog
	_file_dialog = FileDialog.new()
	_file_dialog.access = FileDialog.ACCESS_FILESYSTEM
	add_child(_file_dialog)

	# Setup UI mouse filters safely:
	_setup_ui_mouse_filters()

	# Validate inspector and connect region_selected -> inspector.set_region
	if inspector == null:
		push_error("InspectorPanel not found at ToolLayer/UI/InspectorPanel.")
	else:
		if not inspector.has_method("set_region"):
			push_error("InspectorPanel missing set_region method!")
		else:
			inspector.visible = false
			if not region_selected.is_connected(Callable(inspector, "set_region")):
				region_selected.connect(Callable(inspector, "set_region"))
				_log("Connected region_selected -> inspector.set_region")

	_setup_autosave()


func _setup_ui_mouse_filters() -> void:
	if ui_root == null:
		return
	# Make the main UI container ignore mouse so map receives clicks.
	# Interactive children must explicitly receive input (we set them to STOP).
	ui_root.mouse_filter = Control.MOUSE_FILTER_IGNORE

	# Toolbar and interactive controls should still receive input
	var toolbar := ui_root.get_node_or_null("Toolbar")
	if toolbar and toolbar is Control:
		toolbar.mouse_filter = Control.MOUSE_FILTER_STOP
		for child in toolbar.get_children():
			if child is Control:
				child.mouse_filter = Control.MOUSE_FILTER_STOP

	if region_list:
		region_list.mouse_filter = Control.MOUSE_FILTER_STOP

	if inspector and inspector is Control:
		inspector.mouse_filter = Control.MOUSE_FILTER_STOP


func _setup_autosave() -> void:
	autosave_timer = Timer.new()
	autosave_timer.wait_time = autosave_interval
	autosave_timer.one_shot = false
	autosave_timer.connect("timeout", Callable(self, "_on_autosave_timeout"))
	add_child(autosave_timer)
	if autosave_enabled:
		autosave_timer.start()


func set_autosave_enabled(enabled: bool) -> void:
	autosave_enabled = enabled
	if autosave_timer:
		if enabled:
			autosave_timer.start()
		else:
			autosave_timer.stop()
	_log("Autosave " + ("enabled" if enabled else "disabled"))


func set_autosave_interval(seconds: float) -> void:
	autosave_interval = max(10.0, seconds)
	if autosave_timer:
		autosave_timer.wait_time = autosave_interval
	_log("Autosave interval set to " + str(autosave_interval) + "s")


func _on_autosave_timeout() -> void:
	if region_layer.get_child_count() > 0:
		var autosave_path := "user://autosave_map.json"
		save_map(autosave_path, true)
		_log("Autosaved to: " + autosave_path)


# -------------------------
# Region Registration
# -------------------------
func _register_region(region: Node2D) -> void:
	if region not in _region_index:
		_region_index.append(region)
	
	var meta: RegionMetadata = region.get_node_or_null("RegionMetadata")
	if meta and meta.region_id != "":
		_region_id_set[meta.region_id] = region
	
	if region_list:
		var name_str := ""
		if meta:
			name_str = meta.region_id if meta.region_id != "" else "Region_" + str(_region_index.size() - 1)
		else:
			name_str = "Region_" + str(_region_index.size() - 1)
		region_list.add_item(name_str)


func _unregister_region(region: Node2D) -> void:
	var idx := _region_index.find(region)
	if idx >= 0:
		_region_index.remove_at(idx)
		if region_list and idx < region_list.item_count:
			region_list.remove_item(idx)
	
	var meta: RegionMetadata = region.get_node_or_null("RegionMetadata")
	if meta and meta.region_id != "" and _region_id_set.has(meta.region_id):
		_region_id_set.erase(meta.region_id)


func _clear_all_regions() -> void:
	for child in region_layer.get_children():
		child.queue_free()
	_region_index.clear()
	_region_id_set.clear()
	if region_list:
		region_list.clear()


func _generate_unique_region_id() -> String:
	_region_counter += 1
	var candidate := "region_" + str(_region_counter)
	while _region_id_set.has(candidate):
		_region_counter += 1
		candidate = "region_" + str(_region_counter)
	return candidate


func _is_region_id_unique(id: String, exclude_region: Node2D = null) -> bool:
	if id == "":
		return false
	if not _region_id_set.has(id):
		return true
	return _region_id_set[id] == exclude_region


# -------------------------
# Undo/Redo System
# -------------------------
enum UndoType { FULL_SNAPSHOT, METADATA_CHANGE, REGION_CREATE, REGION_DELETE }

func _save_undo_state(action_name: String, undo_type: int = UndoType.FULL_SNAPSHOT, diff_data: Dictionary = {}) -> void:
	var entry: Dictionary = {
		"action": action_name,
		"type": undo_type,
		"diff": diff_data
	}
	
	if undo_type == UndoType.FULL_SNAPSHOT:
		entry["snapshot"] = _capture_map_state()
	
	undo_stack.append(entry)
	if undo_stack.size() > MAX_UNDO_STEPS:
		undo_stack.pop_front()
	redo_stack.clear()


func _save_metadata_undo(region: Node2D, old_meta: Dictionary) -> void:
	var meta: RegionMetadata = region.get_node_or_null("RegionMetadata")
	if meta == null:
		return
	
	var region_idx := _region_index.find(region)
	_save_undo_state("metadata_change", UndoType.METADATA_CHANGE, {
		"region_idx": region_idx,
		"old_meta": old_meta,
		"new_meta": meta.to_dict()
	})


func _capture_map_state() -> Dictionary:
	var regions_data: Array = []
	for region in _region_index:
		var meta: RegionMetadata = region.get_node_or_null("RegionMetadata")
		var poly: Polygon2D = region.get_node_or_null("Polygon2D")
		if meta and poly:
			var pts: Array = []
			for v in poly.polygon:
				pts.append([v.x, v.y])
			
			var anchors_data: Array = []
			for anchor in get_anchors_for_region(region):
				anchors_data.append({
					"type": anchor.get_meta("anchor_type"),
					"x": anchor.position.x,
					"y": anchor.position.y,
					"capacity": anchor.get_meta("capacity", 1)
				})
			
			var custom_data: Dictionary = {}
			for meta_key in meta.get_meta_list():
				custom_data[meta_key] = meta.get_meta(meta_key)
			
			regions_data.append({
				"metadata": meta.to_dict(),
				"custom": custom_data,
				"polygon": pts,
				"anchors": anchors_data
			})
	
	var base_path := ""
	if base_map.texture != null:
		base_path = base_map.texture.resource_path
	
	return {
		"base_map": base_path,
		"regions": regions_data,
		"anchor_counter": _anchor_counter,
		"region_counter": _region_counter
	}


func _restore_map_state(state: Dictionary) -> void:
	_clear_all_regions()
	
	_anchor_counter = state.get("anchor_counter", 0)
	_region_counter = state.get("region_counter", 0)

	if state.has("base_map") and state["base_map"] != "":
		var tex = ResourceLoader.load(state["base_map"])
		if tex:
			base_map.texture = tex

	var regions_data: Array = state.get("regions", [])
	for region_data in regions_data:
		_create_region_from_data(region_data)

	current_region = null
	if inspector:
		inspector.visible = false


func _apply_undo_entry(entry: Dictionary) -> Dictionary:
	var undo_type: int = entry.get("type", UndoType.FULL_SNAPSHOT)
	var reverse_entry: Dictionary = {"action": "redo", "type": undo_type}
	
	match undo_type:
		UndoType.FULL_SNAPSHOT:
			reverse_entry["snapshot"] = _capture_map_state()
			_restore_map_state(entry["snapshot"])
		
		UndoType.METADATA_CHANGE:
			var diff: Dictionary = entry["diff"]
			var region_idx: int = diff["region_idx"]
			if region_idx >= 0 and region_idx < _region_index.size():
				var region: Node2D = _region_index[region_idx]
				var meta: RegionMetadata = region.get_node_or_null("RegionMetadata")
				if meta:
					reverse_entry["diff"] = {
						"region_idx": region_idx,
						"old_meta": meta.to_dict(),
						"new_meta": diff["old_meta"]
					}
					_apply_metadata_dict(meta, diff["old_meta"])
					_update_region_color(region)
					_update_region_list_name(region)
	
	return reverse_entry


func _apply_metadata_dict(meta: RegionMetadata, data: Dictionary) -> void:
	meta.region_id = str(data.get("region_id", ""))
	meta.ipc_value = int(data.get("ipc", 0))
	meta.faction = str(data.get("faction", ""))
	meta.is_victory_city = bool(data.get("victory", false))
	meta.has_factory = bool(data.get("factory", false))


func undo() -> void:
	if undo_stack.size() == 0:
		print("Nothing to undo")
		return
	
	var entry: Dictionary = undo_stack.pop_back()
	var reverse_entry := _apply_undo_entry(entry)
	redo_stack.append(reverse_entry)
	print("Undo:", entry.get("action", "unknown"))


func redo() -> void:
	if redo_stack.size() == 0:
		print("Nothing to redo")
		return
	
	var entry: Dictionary = redo_stack.pop_back()
	var reverse_entry := _apply_undo_entry(entry)
	undo_stack.append(reverse_entry)
	print("Redo:", entry.get("action", "unknown"))


# -------------------------
# Camera panning + keyboard shortcuts
# -------------------------
func _process(delta: float) -> void:
	if map_root == null:
		return

	var move: Vector2 = Vector2.ZERO

	if Input.is_action_pressed("ui_right"):
		move.x += pan_speed * delta
	if Input.is_action_pressed("ui_left"):
		move.x -= pan_speed * delta
	if Input.is_action_pressed("ui_down"):
		move.y += pan_speed * delta
	if Input.is_action_pressed("ui_up"):
		move.y -= pan_speed * delta

	map_root.position += move


func _unhandled_key_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed:
		if event.keycode == KEY_Z and event.ctrl_pressed and not event.shift_pressed:
			undo()
			get_viewport().set_input_as_handled()
		elif (event.keycode == KEY_Z and event.ctrl_pressed and event.shift_pressed) or \
			 (event.keycode == KEY_Y and event.ctrl_pressed):
			redo()
			get_viewport().set_input_as_handled()
		elif event.keycode == KEY_S and event.ctrl_pressed:
			_on_save_button_pressed()
			get_viewport().set_input_as_handled()
		elif event.keycode == KEY_DELETE and current_region != null:
			_delete_current_region()
			get_viewport().set_input_as_handled()
		elif event.keycode == KEY_ESCAPE:
			if is_drawing:
				_cancel_drawing()
			else:
				_deselect_region()
			get_viewport().set_input_as_handled()
		elif event.keycode == KEY_B and event.ctrl_pressed:
			toggle_batch_mode()
			get_viewport().set_input_as_handled()


func _cancel_drawing() -> void:
	is_drawing = false
	drawing_points.clear()
	if preview_poly:
		preview_poly.queue_free()
		preview_poly = null
	_log("Drawing cancelled")


func _deselect_region() -> void:
	current_region = null
	if inspector:
		inspector.visible = false
	_update_all_region_colors()
	_log("Region deselected")


func _delete_current_region() -> void:
	if current_region == null:
		return
	
	_save_undo_state("delete_region")
	
	region_deleted.emit(current_region)
	_unregister_region(current_region)
	current_region.queue_free()
	current_region = null
	
	if inspector:
		inspector.visible = false
	
	_log("Region deleted")


# -------------------------
# Faction Colors
# -------------------------
func get_faction_color(faction: String) -> Color:
	if faction_colors.has(faction):
		return faction_colors[faction]
	return faction_colors[""]


func set_faction_color(faction: String, color: Color) -> void:
	faction_colors[faction] = color
	_update_all_region_colors()


func _update_all_region_colors() -> void:
	for region in _region_index:
		_update_region_color(region)


func _update_region_color(region: Node2D) -> void:
	var meta: RegionMetadata = region.get_node_or_null("RegionMetadata")
	var poly: Polygon2D = region.get_node_or_null("Polygon2D") as Polygon2D
	if meta and poly:
		var base_color := get_faction_color(meta.faction)
		if region == current_region:
			poly.color = Color(
				min(base_color.r + 0.3, 1.0),
				min(base_color.g + 0.3, 1.0),
				min(base_color.b + 0.3, 1.0),
				0.6
			)
		elif region in batch_selected_regions:
			poly.color = Color(
				min(base_color.r + 0.2, 1.0),
				min(base_color.g + 0.2, 1.0),
				base_color.b,
				0.5
			)
		else:
			poly.color = base_color


func on_region_metadata_changed(region: Node2D) -> void:
	var meta: RegionMetadata = region.get_node_or_null("RegionMetadata")
	if meta:
		# Remove old ID if changed
		for old_id in _region_id_set.keys():
			if _region_id_set[old_id] == region and old_id != meta.region_id:
				_region_id_set.erase(old_id)
				break
		# Add new ID
		if meta.region_id != "":
			_region_id_set[meta.region_id] = region
	
	_update_region_color(region)
	_update_region_list_name(region)


func _update_region_list_name(region: Node2D) -> void:
	if region_list == null:
		return
	var idx := _region_index.find(region)
	if idx >= 0 and idx < region_list.item_count:
		var meta: RegionMetadata = region.get_node_or_null("RegionMetadata")
		if meta:
			var name_str := meta.region_id if meta.region_id != "" else "Region_" + str(idx)
			region_list.set_item_text(idx, name_str)


# -------------------------
# Anchor Points System
# -------------------------
func add_anchor_to_region(region: Node2D, anchor_type: String, position: Vector2, capacity: int = 1) -> Node2D:
	_anchor_counter += 1
	var anchor := Node2D.new()
	anchor.name = "Anchor_" + anchor_type + "_" + str(_anchor_counter)
	anchor.position = position
	anchor.set_meta("anchor_type", anchor_type)
	anchor.set_meta("capacity", capacity)
	anchor.set_meta("occupied", 0)
	region.add_child(anchor)
	return anchor


func get_anchors_for_region(region: Node2D, anchor_type: String = "") -> Array:
	var anchors: Array = []
	for child in region.get_children():
		if child.has_meta("anchor_type"):
			if anchor_type == "" or child.get_meta("anchor_type") == anchor_type:
				anchors.append(child)
	return anchors


func get_available_anchor(region: Node2D, anchor_type: String) -> Node2D:
	for anchor in get_anchors_for_region(region, anchor_type):
		var occupied: int = anchor.get_meta("occupied", 0)
		var capacity: int = anchor.get_meta("capacity", 1)
		if occupied < capacity:
			return anchor
	return null


# -------------------------
# Batch Operations
# -------------------------
func toggle_batch_mode() -> void:
	batch_mode = not batch_mode
	if not batch_mode:
		batch_selected_regions.clear()
	_update_all_region_colors()
	print("Batch mode:", "ON" if batch_mode else "OFF")


func batch_set_faction(faction: String) -> void:
	if batch_selected_regions.size() == 0:
		print("No regions selected for batch operation")
		return
	
	_save_undo_state("batch_set_faction")
	
	for region in batch_selected_regions:
		var meta: RegionMetadata = region.get_node_or_null("RegionMetadata")
		if meta:
			meta.faction = faction
	
	_update_all_region_colors()
	print("Batch set faction to:", faction, "for", batch_selected_regions.size(), "regions")


func batch_set_metadata(key: String, value) -> void:
	if batch_selected_regions.size() == 0:
		print("No regions selected for batch operation")
		return
	
	_save_undo_state("batch_set_" + key)
	
	for region in batch_selected_regions:
		var meta: RegionMetadata = region.get_node_or_null("RegionMetadata")
		if meta and key in meta:
			meta.set(key, value)
	
	_update_all_region_colors()
	print("Batch set", key, "to:", value, "for", batch_selected_regions.size(), "regions")


# -------------------------
# Search and Filter
# -------------------------
func find_regions_by_faction(faction: String) -> Array:
	var results: Array = []
	for region in _region_index:
		var meta: RegionMetadata = region.get_node_or_null("RegionMetadata")
		if meta and meta.faction == faction:
			results.append(region)
	return results


func find_regions_by_id(search_term: String) -> Array:
	var results: Array = []
	var search_lower := search_term.to_lower()
	for region in _region_index:
		var meta: RegionMetadata = region.get_node_or_null("RegionMetadata")
		if meta and meta.region_id.to_lower().contains(search_lower):
			results.append(region)
	return results


func find_region_by_exact_id(region_id: String) -> Node2D:
	if _region_id_set.has(region_id):
		return _region_id_set[region_id]
	return null


# -------------------------
# Load map or texture
# -------------------------
func load_map(path: String) -> void:
	_log("Loading map: " + path)
	if path.to_lower().ends_with(".json"):
		load_map_from_json(path)
		return

	var tex = ResourceLoader.load(path)
	if tex == null:
		push_error("Failed to load texture at: " + path)
		return

	base_map.texture = tex
	base_map.position = Vector2.ZERO
	print("Map texture loaded successfully.")


# -------------------------
# JSON loader with validation
# -------------------------
func load_map_from_json(path: String) -> void:
	print("Loading map data from JSON:", path)

	var file = FileAccess.open(path, FileAccess.READ)
	if file == null:
		var err := FileAccess.get_open_error()
		push_error("Could not open JSON: " + path + " (error: " + str(err) + ")")
		return

	var text: String = file.get_as_text()
	file.close()

	var json := JSON.new()
	var parse_err := json.parse(text)
	if parse_err != OK:
		push_error("JSON parse failed: " + json.get_error_message() + " at line " + str(json.get_error_line()))
		return
	
	var data = json.data
	if data == null or typeof(data) != TYPE_DICTIONARY:
		push_error("JSON root is not a valid Dictionary")
		return

	_log("Parsed top-level keys: " + str(data.keys()))

	# Save undo state before loading
	if _region_index.size() > 0:
		_save_undo_state("load_map")

	# Load base map
	if data.has("base_map"):
		var bm: String = str(data["base_map"])
		if bm != "":
			var tex = ResourceLoader.load(bm)
			if tex != null:
				base_map.texture = tex
				base_map.position = Vector2.ZERO
				_log("Loaded base_map: " + bm)
			else:
				push_error("Could not load base_map texture: " + bm)

	# Clear existing
	_clear_all_regions()

	# Restore counters
	_anchor_counter = data.get("anchor_counter", 0)
	_region_counter = data.get("region_counter", 0)

	# Load faction colors
	if data.has("faction_colors"):
		var fc: Dictionary = data["faction_colors"]
		for faction_name in fc.keys():
			var c = fc[faction_name]
			if typeof(c) == TYPE_ARRAY and c.size() >= 4:
				faction_colors[faction_name] = Color(c[0], c[1], c[2], c[3])

	# Support both array format (new) and dictionary format (legacy)
	var regions_to_load: Array = []
	
	if data.has("regions") and typeof(data["regions"]) == TYPE_ARRAY:
		regions_to_load = data["regions"]
	else:
		for key in data.keys():
			if key in ["base_map", "faction_colors", "version", "anchor_counter", "region_counter"]:
				continue
			var entry = data[key]
			if typeof(entry) == TYPE_DICTIONARY:
				regions_to_load.append(entry)

	# Validate and create regions
	var created_count: int = 0
	var validation_warnings: Array = []
	
	for region_data in regions_to_load:
		var warnings := _validate_region_data(region_data)
		validation_warnings.append_array(warnings)
		
		if _create_region_from_data(region_data) != null:
			created_count += 1

	for warning in validation_warnings:
		push_warning("Load validation: " + warning)

	last_save_path = path
	map_loaded.emit(path)
	print("Map JSON loaded. Regions:", created_count)


func _validate_region_data(region_data: Dictionary) -> Array:
	var warnings: Array = []
	
	var poly_points = region_data.get("polygon", [])
	if typeof(poly_points) != TYPE_ARRAY or poly_points.size() < 3:
		warnings.append("Invalid or insufficient polygon points")
		return warnings
	
	# Check for degenerate polygon (all points same)
	var first_pt = poly_points[0]
	var all_same := true
	for p in poly_points:
		if typeof(p) == TYPE_ARRAY and p.size() >= 2:
			if p[0] != first_pt[0] or p[1] != first_pt[1]:
				all_same = false
				break
	if all_same:
		warnings.append("Degenerate polygon (all points identical)")
	
	# Check anchors within reasonable bounds
	if region_data.has("anchors"):
		var pts: Array = []
		for p in poly_points:
			if typeof(p) == TYPE_ARRAY and p.size() >= 2:
				pts.append(Vector2(p[0], p[1]))
		
		var bounds := _get_polygon_bounds(pts)
		for anchor_data in region_data["anchors"]:
			var ax: float = anchor_data.get("x", 0)
			var ay: float = anchor_data.get("y", 0)
			var margin := 100.0
			if ax < bounds.position.x - margin or ax > bounds.end.x + margin or \
			   ay < bounds.position.y - margin or ay > bounds.end.y + margin:
				warnings.append("Anchor outside region bounds: " + str(Vector2(ax, ay)))
	
	return warnings


func _get_polygon_bounds(points: Array) -> Rect2:
	if points.size() == 0:
		return Rect2()
	var min_pt: Vector2 = points[0]
	var max_pt: Vector2 = points[0]
	for p in points:
		min_pt.x = min(min_pt.x, p.x)
		min_pt.y = min(min_pt.y, p.y)
		max_pt.x = max(max_pt.x, p.x)
		max_pt.y = max(max_pt.y, p.y)
	return Rect2(min_pt, max_pt - min_pt)


# -------------------------
# Create region from data
# -------------------------
func _create_region_from_data(region_data: Dictionary) -> Node2D:
	var meta_dict: Dictionary = region_data.get("metadata", {})
	var poly_points = region_data.get("polygon", [])

	if typeof(poly_points) != TYPE_ARRAY:
		return null

	var pts: Array = []
	for p in poly_points:
		if typeof(p) == TYPE_ARRAY and p.size() >= 2:
			pts.append(Vector2(p[0], p[1]))

	if pts.size() < 3:
		return null

	var region: Node2D = Node2D.new()
	region_layer.add_child(region)

	var poly: Polygon2D = Polygon2D.new()
	poly.name = "Polygon2D"
	poly.polygon = pts
	region.add_child(poly)

	var area: Area2D = Area2D.new()
	area.name = "Area2D"
	area.input_pickable = true
	region.add_child(area)

	var col: CollisionPolygon2D = CollisionPolygon2D.new()
	col.name = "CollisionPolygon2D"
	col.polygon = pts
	area.add_child(col)

	_log("Created Area2D/CollisionPolygon2D for region with " + str(pts.size()) + " points")

	# Connect input_event with region bound via Callable.bind (bind returns a Callable)
	area.connect("input_event", Callable(self, "_on_region_input_event").bind(region))

	var meta: RegionMetadata = RegionMetadata.new()
	meta.name = "RegionMetadata"
	
	var loaded_id: String = str(meta_dict.get("region_id", ""))

	if loaded_id == "" or _region_id_set.has(loaded_id):
		loaded_id = _generate_unique_region_id()
	
	meta.region_id = loaded_id
	meta.ipc_value = int(meta_dict.get("ipc", 0))
	meta.faction = str(meta_dict.get("faction", ""))
	meta.is_victory_city = bool(meta_dict.get("victory", false))
	meta.has_factory = bool(meta_dict.get("factory", false))
	
	var custom_data: Dictionary = region_data.get("custom", meta_dict.get("custom", {}))
	for custom_key in custom_data.keys():
		meta.set_meta(custom_key, custom_data[custom_key])
	
	region.add_child(meta)

	if region_data.has("anchors"):
		for anchor_data in region_data["anchors"]:
			var anchor_type: String = anchor_data.get("type", "unit")
			var anchor_pos := Vector2(anchor_data.get("x", 0), anchor_data.get("y", 0))
			var capacity: int = anchor_data.get("capacity", 1)
			add_anchor_to_region(region, anchor_type, anchor_pos, capacity)

	_update_region_color(region)
	_register_region(region)

	return region


# -------------------------
# Start drawing a new region
# -------------------------
func start_new_region() -> void:
	_log("Starting new region...")
	is_drawing = true
	drawing_points.clear()
	current_region = null

	preview_poly = Line2D.new()
	preview_poly.width = 2
	preview_poly.default_color = Color.YELLOW
	preview_poly.closed = false
	map_root.add_child(preview_poly)


# -------------------------
# Mouse input for drawing
# -------------------------
func _input(event: InputEvent) -> void:
	if not is_drawing:
		return

	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_RIGHT:
			if drawing_points.size() > 2:
				_finalize_region()
			return

		if event.button_index == MOUSE_BUTTON_LEFT:
			var pos: Vector2 = get_global_mouse_position()
			drawing_points.append(pos)
			_log("Added point: " + str(pos))

			if preview_poly:
				preview_poly.points = drawing_points


# -------------------------
# Finalize region creation
# -------------------------
func _finalize_region() -> void:
	_log("Finalizing region...")
	is_drawing = false

	_save_undo_state("create_region")

	if preview_poly:
		preview_poly.queue_free()
		preview_poly = null

	var region: Node2D = Node2D.new()
	region_layer.add_child(region)

	var poly: Polygon2D = Polygon2D.new()
	poly.name = "Polygon2D"
	poly.polygon = drawing_points
	poly.color = get_faction_color("")
	region.add_child(poly)

	var area: Area2D = Area2D.new()
	area.name = "Area2D"
	area.input_pickable = true
	region.add_child(area)

	var col: CollisionPolygon2D = CollisionPolygon2D.new()
	col.name = "CollisionPolygon2D"
	col.polygon = drawing_points
	area.add_child(col)

	_log("Created Area2D/CollisionPolygon2D for new region, pts: " + str(drawing_points.size()))

	# Connect input_event with region bound via Callable.bind
	area.connect("input_event", Callable(self, "_on_region_input_event").bind(region))

	var meta: RegionMetadata = RegionMetadata.new()
	meta.name = "RegionMetadata"
	meta.region_id = _generate_unique_region_id()
	region.add_child(meta)

	# Add default unit anchor at centroid
	var centroid := _polygon_centroid(drawing_points)
	add_anchor_to_region(region, "unit", centroid, 5)

	_register_region(region)

	current_region = region
	_select_region(region)

	region_created.emit(region)


func _polygon_centroid(points: Array) -> Vector2:
	if points.size() == 0:
		return Vector2.ZERO
	var sum: Vector2 = Vector2.ZERO
	for p in points:
		sum += p
	return sum / points.size()


# -------------------------
# Region input handler
# -------------------------
func _on_region_input_event(viewport: Viewport, event: InputEvent, shape_idx: int, region: Node2D) -> void:
	_log("on_region_input_event: " + str(event) + " for " + str(region))
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		if batch_mode:
			_toggle_batch_selection(region)
		else:
			_select_region(region)
		get_viewport().set_input_as_handled()


func _toggle_batch_selection(region: Node2D) -> void:
	if region in batch_selected_regions:
		batch_selected_regions.erase(region)
	else:
		batch_selected_regions.append(region)
	_update_all_region_colors()
	_log("Batch selected: " + str(batch_selected_regions.size()) + " regions")


# -------------------------
# Select region
# -------------------------
func _select_region(region: Node2D) -> void:
	_log("Selected region: " + str(region))
	current_region = region
	if inspector != null:
		inspector.visible = true
	
	region_selected.emit(region)
	_update_all_region_colors()


# -------------------------
# Button handlers
# -------------------------
func _on_load_map_button_pressed() -> void:
	_log("Load Map button pressed")
	_file_dialog.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	_file_dialog.filters = PackedStringArray(["*.png ; PNG Images", "*.jpg ; JPEG Images", "*.json ; Map JSON"])
	_file_dialog.current_file = ""
	
	# Disconnect previous and reconnect
	if _file_dialog.file_selected.is_connected(Callable(self, "load_map")):
		_file_dialog.file_selected.disconnect(Callable(self, "load_map"))
	if _file_dialog.file_selected.is_connected(Callable(self, "_on_save_file_selected")):
		_file_dialog.file_selected.disconnect(Callable(self, "_on_save_file_selected"))
	
	_file_dialog.file_selected.connect(Callable(self, "load_map"))
	_file_dialog.popup_centered()


func _on_load_regions_button_pressed() -> void:
	_log("Load Regions button pressed")
	_file_dialog.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	_file_dialog.filters = PackedStringArray(["*.json ; Map JSON"])
	_file_dialog.current_file = ""
	if _file_dialog.file_selected.is_connected(Callable(self, "load_map_from_json")):
		_file_dialog.file_selected.disconnect(Callable(self, "load_map_from_json"))
	_file_dialog.file_selected.connect(Callable(self, "load_map_from_json"))
	_file_dialog.popup_centered()


func _on_add_region_button_pressed() -> void:
	_log("Add Region button pressed")
	start_new_region()


func _on_save_button_pressed() -> void:
	_log("Save Map button pressed")
	_file_dialog.file_mode = FileDialog.FILE_MODE_SAVE_FILE
	_file_dialog.filters = PackedStringArray(["*.json ; Map JSON"])
	_file_dialog.current_file = last_save_path.get_file()
	if _file_dialog.file_selected.is_connected(Callable(self, "_on_save_file_selected")):
		_file_dialog.file_selected.disconnect(Callable(self, "_on_save_file_selected"))
	_file_dialog.file_selected.connect(Callable(self, "_on_save_file_selected"))
	_file_dialog.popup_centered()


func _on_save_file_selected(path: String) -> void:
	save_map(path)


# -------------------------
# Save map to JSON
# -------------------------
func save_map(path: String, silent: bool = false) -> void:
	if not silent:
		print("Saving map...")

	# Validate before saving
	var validation_errors := _validate_map_data()
	if validation_errors.size() > 0:
		for err in validation_errors:
			push_warning("Map validation: " + err)

	var data: Dictionary = {}
	
	# Version for future compatibility
	data["version"] = 2

	if base_map.texture != null and base_map.texture.resource_path != "":
		data["base_map"] = base_map.texture.resource_path

	# Save faction colors
	var fc_data: Dictionary = {}
	for faction_name in faction_colors.keys():
		var c: Color = faction_colors[faction_name]
		fc_data[faction_name] = [c.r, c.g, c.b, c.a]
	data["faction_colors"] = fc_data

	# Save counters
	data["anchor_counter"] = _anchor_counter
	data["region_counter"] = _region_counter

	# Regions as array
	var regions_array: Array = []
	for region in _region_index:
		var meta: RegionMetadata = region.get_node_or_null("RegionMetadata")
		if meta == null:
			continue

		var poly: Polygon2D = region.get_node_or_null("Polygon2D") as Polygon2D
		if poly == null:
			continue

		var pts: Array = []
		for v in poly.polygon:
			pts.append([v.x, v.y])

		var region_data: Dictionary = {
			"metadata": meta.to_dict(),
			"polygon": pts
		}

		# Save custom metadata
		var custom_data: Dictionary = {}
		for meta_key in meta.get_meta_list():
			custom_data[meta_key] = meta.get_meta(meta_key)
		if custom_data.size() > 0:
			region_data["custom"] = custom_data

		# Save anchors
		var anchors_data: Array = []
		for anchor in get_anchors_for_region(region):
			anchors_data.append({
				"type": anchor.get_meta("anchor_type"),
				"x": anchor.position.x,
				"y": anchor.position.y,
				"capacity": anchor.get_meta("capacity", 1)
			})
		if anchors_data.size() > 0:
			region_data["anchors"] = anchors_data

		regions_array.append(region_data)

	data["regions"] = regions_array

	# Simple, robust write
	var content := JSON.stringify(data, "\t")

	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		push_error("Could not open file for writing: " + path)
		return

	file.store_string(content)
	file.close()

	last_save_path = path
	if not silent:
		print("Map saved to:", path)
	map_saved.emit(path)


func _validate_map_data() -> Array:
	var errors: Array = []
	# Ensure unique non-empty IDs
	var ids := {}
	for region in _region_index:
		var meta: RegionMetadata = region.get_node_or_null("RegionMetadata")
		if meta:
			var id := meta.region_id
			if id == "" or id == null:
				errors.append("Empty region_id for region at index " + str(_region_index.find(region)))
			elif ids.has(id):
				errors.append("Duplicate region_id: " + id)
			else:
				ids[id] = true
	return errors


# -------------------------
# Fallback selection (diagnostic)
# -------------------------
# If UI blocks events, this fallback uses point-in-polygon to select regions.
func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		# If we already handled selection via Area2D, skip
		if current_region != null:
			return
		# Convert global mouse to map_root local
		var pos := map_root.to_local(get_global_mouse_position())
		for region in _region_index:
			var poly := region.get_node_or_null("Polygon2D") as Polygon2D
			if poly and _is_point_in_polygon(pos, poly.polygon):
				_select_region(region)
				get_viewport().set_input_as_handled()
				return


# -------------------------
# Point-in-polygon helper (ray casting)
# -------------------------
func _is_point_in_polygon(point: Vector2, polygon: Array) -> bool:
	# Ray casting algorithm (robust, typed locals)
	var inside: bool = false
	var n: int = polygon.size()
	if n < 3:
		return false
	var j: int = n - 1
	for i in range(n):
		var pi: Vector2 = polygon[i]
		var pj: Vector2 = polygon[j]
		# Avoid division by zero when edge is horizontal
		var denom: float = (pj.y - pi.y)
		var intersect: bool = false
		if denom != 0.0:
			intersect = ((pi.y > point.y) != (pj.y > point.y)) and \
				(point.x < (pj.x - pi.x) * (point.y - pi.y) / denom + pi.x)
		# If denom == 0.0, the horizontal edge cannot intersect the horizontal ray in a meaningful way
		if intersect:
			inside = not inside
		j = i
	return inside
