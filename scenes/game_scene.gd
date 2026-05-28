extends Control
class_name GameScene

# Auto‑bound scene references
var map_root: Node = null
var unit_visualizer: Node = null

var state_label: Label = null
var faction_selector: OptionButton = null
var spawn_infantry_button: Button = null
var move_unit_button: Button = null
var end_phase_button: Button = null
var end_turn_button: Button = null
var event_log: RichTextLabel = null

# Game session (GameSessionStub via factory, or full GameSession)
var session = null
var _command_counter: int = 0
var _pending_spawn_count: int = 0

# Debug
var debug: bool = true


func _ready() -> void:
	var current := get_tree().current_scene
	if current:
		print("Loaded scene file:", current.scene_file_path)

	if debug:
		print("GameScene _ready: this node path=", get_path())
		print("GameScene _ready: children=", get_children().map(func(c): return c.name))

	# Allow map clicks through UI
	var ui_root_node = find_child("UIRoot", true, false)
	if ui_root_node and ui_root_node is Control:
		ui_root_node.mouse_filter = Control.MOUSE_FILTER_IGNORE
		if debug:
			print("GameScene: Set UIRoot.mouse_filter = IGNORE")

	_autobind_nodes()
	_setup_faction_selector()
	_connect_ui()

	# Confirm event_log binding for visibility debugging
	if debug:
		print("GameScene: event_log bound ->", event_log)

	# Try to enable UnitVisualizer debug logging and assign a default icon scene at runtime
	if unit_visualizer:
		# enable debug logging (UnitVisualizer exports this)
		unit_visualizer.debug_logging = true

		# if no unit_icon_scene assigned, try to assign a simple UnitIcon if it exists
		if unit_visualizer.unit_icon_scene == null:
			var candidate_path := "res://scenes/UnitIcon.tscn"
			if ResourceLoader.exists(candidate_path):
				unit_visualizer.unit_icon_scene = load(candidate_path)
				if debug:
					print("GameScene: assigned UnitVisualizer.unit_icon_scene ->", candidate_path)
			else:
				if debug:
					print("GameScene: UnitIcon.tscn not found; UnitVisualizer will use placeholder icons")

	if typeof(GameSessionFactory) != TYPE_NIL:
		session = GameSessionFactory.create(GameSessionFactory.Mode.STUB)
		if debug:
			print("GameScene: Session created via GameSessionFactory (STUB)")
	elif typeof(GameSceneSessionBuilder) != TYPE_NIL:
		session = GameSceneSessionBuilder.create_session_from_newmap()
		if debug:
			print("GameScene: Session created from newmap.json via builder (fallback)")
	else:
		if debug:
			print("GameScene: No session factory found; session left null")

	_refresh_all()

	# Connect region selection
	if map_root and map_root.has_signal("region_selected"):
		map_root.connect("region_selected", Callable(self, "_on_region_selected"))
		if debug:
			print("GameScene: Connected to map_root.region_selected")
	else:
		push_warning("GameScene: map_root not found or missing region_selected signal.")


# ---------------------------------------------------------
# AUTO‑BINDING
# ---------------------------------------------------------
func _autobind_nodes() -> void:
	# MapRoot lives under CanvasLayer
	map_root = find_child("MapRoot", true, false)
	if debug:
		print("GameScene: map_root ->", map_root, " path:", (map_root.get_path() if map_root else "null"))

	# UnitVisualizer lives under MapRoot/UnitLayer
	unit_visualizer = find_child("UnitVisualizer", true, false)
	if debug:
		print("GameScene: unit_visualizer ->", unit_visualizer, " path:", (unit_visualizer.get_path() if unit_visualizer else "null"))

	# UI lives under UIRoot/Panel
	var ui_root = find_child("UIRoot", true, false)
	var panel: Control = null

	if ui_root:
		panel = ui_root.get_node_or_null("Panel")
		if panel == null:
			panel = ui_root.find_child("Panel", true, false)

	if panel:
		state_label = panel.find_child("StateLabel", true, false)
		faction_selector = panel.find_child("FactionSelect", true, false)
		spawn_infantry_button = panel.find_child("SpawnInfantry", true, false)
		move_unit_button = panel.find_child("MoveUnit", true, false)
		end_phase_button = panel.find_child("EndPhase", true, false)
		end_turn_button = panel.find_child("EndTurn", true, false)
		event_log = panel.find_child("EventLog", true, false)

		if debug:
			print("GameScene: UI nodes bound from Panel path:", panel.get_path())
	else:
		if debug:
			print("GameScene: Panel not found under UIRoot")

	if debug:
		print("GameScene: autobind complete. map_root=", map_root, " unit_visualizer=", unit_visualizer)


# ---------------------------------------------------------
# UI SETUP
# ---------------------------------------------------------
func _setup_faction_selector() -> void:
	if faction_selector == null:
		return
	faction_selector.clear()
	faction_selector.add_item("Allies")
	faction_selector.add_item("Axis")
	faction_selector.select(0)


func _connect_ui() -> void:
	if spawn_infantry_button:
		spawn_infantry_button.pressed.connect(_on_spawn_infantry_pressed)
	if move_unit_button:
		move_unit_button.pressed.connect(_on_move_unit_pressed)
	if end_phase_button:
		end_phase_button.pressed.connect(_on_end_phase_pressed)
	if end_turn_button:
		end_turn_button.pressed.connect(_on_end_turn_pressed)

	# Toggle UI visibility with U
	if not InputMap.has_action("toggle_ui_debug"):
		InputMap.add_action("toggle_ui_debug")
		var ev := InputEventKey.new()
		ev.keycode = KEY_U
		InputMap.action_add_event("toggle_ui_debug", ev)
		if debug:
			print("GameScene: Created input action 'toggle_ui_debug' bound to KEY_U")


func _input(event: InputEvent) -> void:
	if Input.is_action_just_pressed("toggle_ui_debug"):
		var ui_root = find_child("UIRoot", true, false)
		if ui_root:
			ui_root.visible = not ui_root.visible
			print("GameScene: toggled UIRoot.visible -> ", ui_root.visible)


# ---------------------------------------------------------
# REGION SELECTION
# ---------------------------------------------------------
func _on_region_selected(region_id: String) -> void:
	# debug trace to confirm signal path
	if debug:
		print("GameScene: _on_region_selected called with ->", region_id)
	_log_system("Selected region: %s" % region_id)


# ---------------------------------------------------------
# COMMAND HANDLERS
# ---------------------------------------------------------
func _on_spawn_infantry_pressed() -> void:
	var phase = _current_phase()

	if phase == "purchase":
		_apply_command("purchase_units", {
			"purchases": [
				{"unit_type_id": "infantry", "count": 1}
			]
		})
		_pending_spawn_count += 1
		_log_system("Purchased 1 infantry. Advance to mobilize phase to place.")

	elif phase == "mobilize":
		var region_id = _selected_region_id()
		if region_id.is_empty():
			_log_system("Select a region before placing units.")
			return

		var count = maxi(_pending_spawn_count, 1)
		_apply_command("place_units", {
			"placements": [
				{
					"region_id": region_id,
					"units": [{"unit_type_id": "infantry", "count": count}]
				}
			]
		})
		_pending_spawn_count = 0

	else:
		_log_system("Spawn only works in purchase or mobilize. Phase: %s" % phase)


func _on_move_unit_pressed() -> void:
	var from_region = _selected_region_id()
	if from_region.is_empty():
		_log_system("Select a source region first.")
		return

	var to_region = ""
	if map_root and session and map_root.has_method("get_first_adjacent_region"):
		to_region = map_root.call("get_first_adjacent_region", from_region, session.state.adjacency)

	if to_region.is_empty():
		_log_system("No adjacent region found for %s." % from_region)
		return

	var faction_id = _selected_faction_id()
	if session and faction_id != str(session.state.current_faction_id):
		_log_system("Move requires active faction.")
		return

	var move_units = _first_movable_stack(from_region, faction_id)
	if move_units.is_empty():
		_log_system("No movable units for current faction in %s." % from_region)
		return

	_apply_command("move_units", {
		"moves": [
			{
				"from_region_id": from_region,
				"to_region_id": to_region,
				"units": [move_units]
			}
		]
	})


func _on_end_phase_pressed() -> void:
	_apply_command("end_phase", {})


func _on_end_turn_pressed() -> void:
	_apply_command("end_turn", {})


# ---------------------------------------------------------
# COMMAND PIPELINE
# ---------------------------------------------------------
func _apply_command(type_name: String, payload: Dictionary) -> void:
	if session == null:
		_log_system("Session not ready.")
		return

	var result: Dictionary = session.apply_command({
		"command_id": _next_command_id(),
		"player_id": _selected_faction_id(),
		"type": type_name,
		"payload": payload,
	})

	if str(result.get("result_type", "")) == "ok":
		for event_dict in result.get("events", []):
			_log_event(event_dict)
	else:
		var err: Dictionary = result.get("error", {})
		_log_system("Command failed [%s]: %s"
			% [str(err.get("code", "UNKNOWN")), str(err.get("message", ""))])

	_refresh_all()


# ---------------------------------------------------------
# SNAPSHOT → MAP + UNITS + UI
# ---------------------------------------------------------
func _refresh_all() -> void:
	_update_state_label()

	if session == null or map_root == null:
		return

	var snapshot = session.get_state()

	if map_root.has_method("update_from_snapshot"):
		map_root.call("update_from_snapshot", snapshot)

	if unit_visualizer and unit_visualizer.has_method("refresh_from_snapshot"):
		unit_visualizer.call("refresh_from_snapshot", snapshot, map_root)


# ---------------------------------------------------------
# UI LABELS
# ---------------------------------------------------------
func _update_state_label() -> void:
	if state_label == null or session == null:
		return

	var snapshot = session.get_state()
	var turn_info = snapshot.get("turn_info", {})
	var ipc = snapshot.get("ipc", {})
	var faction_id = str(turn_info.get("current_faction_id", ""))
	var phase = str(turn_info.get("current_phase", ""))

	state_label.text = (
        "Turn %s  Round %s\nActive: %s  Phase: %s\nIPC allies: %s  axis: %s\nSelected faction: %s"
		% [
			str(turn_info.get("turn_number", "?")),
			str(snapshot.get("game_round", "?")),
			faction_id.capitalize(),
			phase,
			str(ipc.get("allies", 0)),
			str(ipc.get("axis", 0)),
			_selected_faction_display(),
		]
	)


# ---------------------------------------------------------
# HELPERS
# ---------------------------------------------------------
func _first_movable_stack(region_id: String, faction_id: String) -> Dictionary:
	if session == null:
		return {}

	for unit_entry in session.state.get_faction_units_in_region(region_id, faction_id):
		if typeof(unit_entry) != TYPE_DICTIONARY:
			continue
		if unit_entry.has("instance_id"):
			continue
		return {
			"unit_type_id": str(unit_entry.get("unit_type_id", "")),
			"count": 1,
		}
	return {}


func _selected_faction_id() -> String:
	if faction_selector == null:
		return "allies"
	return faction_selector.get_item_text(faction_selector.selected).to_lower()


func _selected_faction_display() -> String:
	if faction_selector == null:
		return "Allies"
	return faction_selector.get_item_text(faction_selector.selected)


func _selected_region_id() -> String:
	if map_root == null:
		return ""
	if map_root.has_method("get_selected_region_id"):
		return str(map_root.call("get_selected_region_id"))
	return ""


func _current_phase() -> String:
	if session == null:
		return ""
	return str(session.state.current_phase)


func _next_command_id() -> String:
	_command_counter += 1
	return "gsc_%04d" % _command_counter


# ---------------------------------------------------------
# LOGGING
# ---------------------------------------------------------
func _log_event(event_dict: Dictionary) -> void:
	if event_log:
		event_log.append_text("%s\n" % str(event_dict))
		# auto scroll to bottom
		event_log.scroll_vertical = event_log.get_line_count()
	if debug:
		print("GameScene: event ->", event_dict)


func _log_system(message: String) -> void:
	if event_log:
		event_log.append_text("[system] %s\n" % message)
		event_log.scroll_vertical = event_log.get_line_count()
	if debug:
		print("GameScene:", message)
