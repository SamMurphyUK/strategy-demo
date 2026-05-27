extends Node
class_name GameController

@export var unit_scene: PackedScene
@export var debug_logging: bool = true

# Core engine
var session: GameSession

# Scene references
var map_root: Node2D
var unit_layer: Node2D
var ui_root: Control

# State
var selected_region_id: String = ""
var faction_id: String = "red" # default for testing

# ---------------------------------------------------------
# READY
# ---------------------------------------------------------
func _ready() -> void:
	# Find nodes
	map_root = get_tree().get_root().find_node("MapRoot", true, false)
	ui_root = get_tree().get_root().find_node("UIRoot", true, false)

	if map_root == null:
		push_error("GameController: MapRoot not found.")
		return

	unit_layer = map_root.get_node_or_null("UnitLayer")
	if unit_layer == null:
		unit_layer = Node2D.new()
		unit_layer.name = "UnitLayer"
		map_root.add_child(unit_layer)

	# Connect region selection
	if map_root.has_signal("region_selected"):
		map_root.region_selected.connect(_on_region_selected)

	# Connect UI buttons
	_connect_ui()

	# Create GameSession
	session = GameSession.new()
	session.load_from_json("res://newmap.json")

	# Initial snapshot
	var snap = session.get_snapshot()
	_apply_snapshot(snap)

	if debug_logging:
		print("GameController ready.")

# ---------------------------------------------------------
# UI CONNECTIONS
# ---------------------------------------------------------
func _connect_ui() -> void:
	if ui_root == null:
		return

	var spawn_btn = ui_root.find_child("SpawnInfantryButton", true, false)
	var move_btn = ui_root.find_child("MoveUnitButton", true, false)
	var end_phase_btn = ui_root.find_child("EndPhaseButton", true, false)
	var end_turn_btn = ui_root.find_child("EndTurnButton", true, false)
	var faction_selector = ui_root.find_child("FactionSelector", true, false)

	if spawn_btn: spawn_btn.pressed.connect(_on_spawn_infantry)
	if move_btn: move_btn.pressed.connect(_on_move_unit)
	if end_phase_btn: end_phase_btn.pressed.connect(_on_end_phase)
	if end_turn_btn: end_turn_btn.pressed.connect(_on_end_turn)
	if faction_selector:
		faction_selector.item_selected.connect(_on_faction_changed)

# ---------------------------------------------------------
# REGION SELECTION
# ---------------------------------------------------------
func _on_region_selected(region_id: String) -> void:
	selected_region_id = region_id
	if debug_logging:
		print("Selected region:", region_id)

# ---------------------------------------------------------
# COMMAND PIPELINE
# ---------------------------------------------------------
func _send_command(cmd: Dictionary) -> void:
	var result = session.apply_command(cmd)
	_apply_snapshot(result.snapshot)
	_append_events(result.events)

# ---------------------------------------------------------
# REAL RULES: PURCHASE INFANTRY
# ---------------------------------------------------------
func _on_spawn_infantry() -> void:
	if selected_region_id == "":
		push_warning("No region selected.")
		return

	# Purchase 1 infantry
	var cmd = {
		"type": "purchase_units",
		"payload": {
			"purchases": [
				{ "unit_type_id": "infantry", "count": 1 }
			]
		}
	}
	_send_command(cmd)

# ---------------------------------------------------------
# REAL RULES: MOVE UNIT
# ---------------------------------------------------------
func _on_move_unit() -> void:
	if selected_region_id == "":
		push_warning("No region selected.")
		return

	var snap = session.get_snapshot()
	var adjacency = snap.get("adjacency", {})
	var neighbors = adjacency.get(selected_region_id, [])

	if neighbors.is_empty():
		push_warning("No adjacent regions.")
		return

	var target = str(neighbors[0])

	var cmd = {
		"type": "move_units",
		"payload": {
			"moves": [
				{
					"from": selected_region_id,
					"to": target,
					"units": [
						{ "unit_type_id": "infantry", "count": 1 }
					]
				}
			]
		}
	}
	_send_command(cmd)

# ---------------------------------------------------------
# END PHASE
# ---------------------------------------------------------
func _on_end_phase() -> void:
	var cmd = { "type": "end_phase", "payload": {} }
	_send_command(cmd)

# ---------------------------------------------------------
# END TURN
# ---------------------------------------------------------
func _on_end_turn() -> void:
	var cmd = { "type": "end_turn", "payload": {} }
	_send_command(cmd)

# ---------------------------------------------------------
# FACTION SELECTOR
# ---------------------------------------------------------
func _on_faction_changed(idx: int) -> void:
	var selector = ui_root.find_child("FactionSelector", true, false)
	if selector:
		faction_id = selector.get_item_text(idx).to_lower()
		if debug_logging:
			print("Faction changed to:", faction_id)

# ---------------------------------------------------------
# SNAPSHOT → SCENE UPDATE
# ---------------------------------------------------------
func _apply_snapshot(snapshot: Dictionary) -> void:
	_update_ui(snapshot)
	_update_units(snapshot)
	map_root.update_from_snapshot(snapshot)

# ---------------------------------------------------------
# UPDATE UI
# ---------------------------------------------------------
func _update_ui(snapshot: Dictionary) -> void:
	var state_label = ui_root.find_child("StateLabel", true, false)
	if state_label:
		var fac = snapshot.get("current_faction", "")
		var phase = snapshot.get("current_phase", "")
		var ipc = snapshot.get("ipc", {}).get(fac, 0)
		state_label.text = "Faction: %s | Phase: %s | IPC: %d" % [fac, phase, ipc]

# ---------------------------------------------------------
# UPDATE UNITS (visual)
# ---------------------------------------------------------
func _update_units(snapshot: Dictionary) -> void:
	# Clear old units
	for child in unit_layer.get_children():
		child.queue_free()

	# Spawn units from snapshot
	for region_entry in snapshot.get("regions", []):
		var region_id = str(region_entry.get("region_id", ""))
		for unit_entry in region_entry.get("units", []):
			var count = int(unit_entry.get("count", 0))
			var type_id = str(unit_entry.get("unit_type_id", ""))

			for i in count:
				_spawn_visual_unit(region_id, type_id)

func _spawn_visual_unit(region_id: String, type_id: String) -> void:
	if unit_scene == null:
		return

	var region_node = map_root.get_node("RegionLayer").find_child(region_id, true, false)
	if region_node == null:
		return

	var poly = region_node.get_node_or_null("Polygon2D")
	if poly == null:
		return

	var centroid = _polygon_centroid(poly.polygon)

	var inst = unit_scene.instantiate()
	inst.position = centroid
	unit_layer.add_child(inst)

# ---------------------------------------------------------
# EVENT LOG
# ---------------------------------------------------------
func _append_events(events: Array) -> void:
	var log = ui_root.find_child("EventLog", true, false)
	if log == null:
		return

	for e in events:
		log.append_text("%s\n" % JSON.stringify(e))

# ---------------------------------------------------------
# UTILS
# ---------------------------------------------------------
func _polygon_centroid(points: Array) -> Vector2:
	if points.is_empty():
		return Vector2.ZERO
	var sum := Vector2.ZERO
	for p in points:
		sum += p
	return sum / points.size()
