extends Node
class_name GameController

@export var unit_scene: PackedScene
@export var debug_logging: bool = true

var _unit_counter: int = 0
var _unit_index: Dictionary = {} # name -> Node2D

var _map_editor: Node = null
var _map_root: Node2D = null
var _unit_layer: Node2D = null

func _ready() -> void:
	_map_editor = _find_map_editor()
	_map_root = get_tree().get_root().find_node("MapRoot", true, false)
	if _map_root == null:
		push_warning("GameController: MapRoot not found in scene tree.")
	# Ensure UnitLayer exists
	if _map_root:
		_unit_layer = _map_root.get_node_or_null("UnitLayer")
		if _unit_layer == null:
			_unit_layer = Node2D.new()
			_unit_layer.name = "UnitLayer"
			_map_root.add_child(_unit_layer)
	if debug_logging:
		print("GameController ready. UnitLayer:", _unit_layer)

func _find_map_editor() -> Node:
	# Try to find MapEditor by method presence
	var root = get_tree().get_root()
	for child in root.get_children():
		if child.has_method("on_region_metadata_changed"):
			return child
	# fallback: search up from this node
	var node = get_parent()
	while node != null:
		if node.has_method("on_region_metadata_changed"):
			return node
		node = node.get_parent()
	return null

func _next_unit_id() -> int:
	_unit_counter += 1
	return _unit_counter

# anchor_identifier can be int index or string name; owner optional
func spawn_unit_at_anchor(region_id: String, anchor_identifier = null, owner: String = "") -> Node2D:
	if unit_scene == null:
		push_error("GameController: unit_scene not set")
		return null

	# Resolve region node
	var region_node: Node = null
	if _map_editor and _map_editor.has_method("find_region_by_exact_id"):
		region_node = _map_editor.find_region_by_exact_id(region_id)
	else:
		# fallback search
		if _map_root:
			var rl = _map_root.get_node_or_null("RegionLayer")
			if rl:
				for r in rl.get_children():
					var meta = r.get_node_or_null("RegionMetadata")
					if meta and str(meta.region_id) == region_id:
						region_node = r
						break

	if region_node == null:
		push_error("spawn_unit_at_anchor: region not found: " + region_id)
		return null

	# Resolve anchor node
	var anchor_node: Node2D = null
	if typeof(anchor_identifier) == TYPE_INT:
		anchor_node = region_node.get_node_or_null("Anchor_" + str(anchor_identifier))
	elif typeof(anchor_identifier) == TYPE_STRING:
		anchor_node = region_node.get_node_or_null(str(anchor_identifier))
	else:
		# find first free unit anchor
		for child in region_node.get_children():
			if child is Node2D and child.has_meta("anchor_type") and child.get_meta("anchor_type") == "unit":
				var cap = child.get_meta("capacity", 1)
				var occ = child.get_meta("occupied", 0)
				if occ < cap:
					anchor_node = child
					break

	if anchor_node == null:
		# fallback to polygon centroid
		var poly: Polygon2D = region_node.get_node_or_null("Polygon2D")
		if poly:
			var centroid := _polygon_centroid(poly.polygon)
			return _instantiate_unit_at_pos(centroid, region_id, "", owner)
		push_warning("spawn_unit_at_anchor: no anchor available for region " + region_id)
		return null

	# Reserve anchor
	var occ = anchor_node.get_meta("occupied", 0)
	var cap = anchor_node.get_meta("capacity", 1)
	if occ >= cap:
		push_warning("spawn_unit_at_anchor: anchor full: " + anchor_node.name)
		return null
	anchor_node.set_meta("occupied", occ + 1)

	# Instantiate unit
	return _instantiate_unit_at_pos(anchor_node.global_position, region_id, anchor_node.name, owner)

func _instantiate_unit_at_pos(global_pos: Vector2, region_id: String, anchor_name, owner: String) -> Node2D:
	var inst = unit_scene.instantiate() as Node2D
	inst.name = "Unit_" + str(_next_unit_id())
	# set properties using unit-specific API to avoid Node.set_owner collision
	if inst.has_method("set_unit_owner"):
		inst.set_unit_owner(owner)
	else:
		# fallback: set a non-conflicting property name
		inst.set("unit_owner", owner)
	inst.set("region_id", region_id)
	inst.set("anchor_name", anchor_name)
	inst.global_position = global_pos
	if _unit_layer:
		_unit_layer.add_child(inst)
	_unit_index[inst.name] = inst
	if debug_logging:
		print("Spawned unit:", inst.name, "at", global_pos, "region:", region_id, "anchor:", anchor_name)
	return inst

func release_anchor(region_id: String, anchor_name) -> void:
	if anchor_name == null or anchor_name == "":
		return
	# find region
	var region_node = null
	if _map_editor and _map_editor.has_method("find_region_by_exact_id"):
		region_node = _map_editor.find_region_by_exact_id(region_id)
	else:
		if _map_root:
			var rl = _map_root.get_node_or_null("RegionLayer")
			if rl:
				for r in rl.get_children():
					var meta = r.get_node_or_null("RegionMetadata")
					if meta and str(meta.region_id) == region_id:
						region_node = r
						break
	if region_node == null:
		return
	var anchor = region_node.get_node_or_null(str(anchor_name))
	if anchor:
		var occ = anchor.get_meta("occupied", 0)
		anchor.set_meta("occupied", max(0, occ - 1))
		if debug_logging:
			print("Released anchor", anchor_name, "in region", region_id)

# Save game (map_state optional)
func save_game(path: String) -> void:
	var data := {}
	# delegate map state to MapEditor if available
	if _map_editor and _map_editor.has_method("capture_map_state"):
		data["map_state"] = _map_editor.capture_map_state()
	# units
	var units_arr := []
	for name in _unit_index.keys():
		var u = _unit_index[name]
		if u == null:
			continue
		var entry := {
			"name": name,
			"region_id": str(u.get("region_id", "")),
			"anchor_name": str(u.get("anchor_name", "")),
			# read the non-conflicting property
			"owner": str(u.get("unit_owner", "")),
			"pos": [u.global_position.x, u.global_position.y]
		}
		units_arr.append(entry)
	data["units"] = units_arr

	var file = FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		push_error("Could not open file for writing: " + path)
		return
	file.store_string(JSON.stringify(data, "\t"))
	file.close()
	if debug_logging:
		print("Saved game to:", path)

# Load game
func load_game(path: String) -> void:
	var file = FileAccess.open(path, FileAccess.READ)
	if file == null:
		push_error("Could not open file for reading: " + path)
		return
	var text = file.get_as_text()
	file.close()
	var j = JSON.parse_string(text)
	if j.error != OK:
		push_error("JSON parse error: " + str(j.error))
		return
	var data = j.result
	# restore map_state if MapEditor supports it
	if _map_editor and _map_editor.has_method("restore_map_state") and data.has("map_state"):
		_map_editor.restore_map_state(data["map_state"])
	# clear existing units
	for name in _unit_index.keys():
		var u = _unit_index[name]
		if u and is_instance_valid(u):
			u.queue_free()
	_unit_index.clear()
	# spawn units
	for entry in data.get("units", []):
		var region_id = str(entry.get("region_id", ""))
		var anchor_name = entry.get("anchor_name", "")
		var owner = str(entry.get("owner", ""))
		var spawned = spawn_unit_at_anchor(region_id, anchor_name, owner)
		if spawned == null:
			var pos_arr = entry.get("pos", null)
			if pos_arr and pos_arr.size() >= 2:
				_instantiate_unit_at_pos(Vector2(pos_arr[0], pos_arr[1]), region_id, anchor_name, owner)

func _polygon_centroid(points: Array) -> Vector2:
	if points.size() == 0:
		return Vector2.ZERO
	var sum = Vector2.ZERO
	for p in points:
		sum += p
	return sum / points.size()


func _on_spawn_button_pressed() -> void:
	spawn_unit_at_anchor("test_region", null, "Player")
	pass # Replace with function body.


func _on_save_button_pressed() -> void:
	save_game("user://test_game.json")
	pass # Replace with function body.


func _on_load_button_pressed() -> void:
	load_game("user://test_game.json")
	pass # Replace with function body.
