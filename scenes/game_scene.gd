extends Control
class_name GameScene

# Auto‑bound scene references
var map_root: GameMapRoot
var unit_visualizer: UnitVisualizer

var state_label: Label
var faction_selector: OptionButton
var spawn_infantry_button: Button
var move_unit_button: Button
var end_phase_button: Button
var end_turn_button: Button
var event_log: RichTextLabel

# Game session
var session: GameSession
var _command_counter: int = 0
var _pending_spawn_count: int = 0


func _ready() -> void:
	_autobind_nodes()
	_setup_faction_selector()
	_connect_ui()

	session = GameSceneSessionBuilder.create_session_from_newmap()
	_refresh_all()

	if map_root:
		map_root.region_selected.connect(_on_region_selected)


# ---------------------------------------------------------
# AUTO‑BINDING
# ---------------------------------------------------------
func _autobind_nodes() -> void:
	# MapRoot
	map_root = get_node_or_null("GameMapRoot")

	# UnitVisualizer (inside UnitLayer)
	var unit_layer := get_node_or_null("UnitLayer")
	if unit_layer:
		unit_visualizer = unit_layer.get_node_or_null("UnitVisualizer")

	# UI
	var ui_root := get_node_or_null("UIRoot/VBox")
	if ui_root == null:
		push_error("UIRoot/VBox not found.")
		return

	state_label = ui_root.get_node_or_null("StateLabel")
	faction_selector = ui_root.get_node_or_null("FactionSelect")
	spawn_infantry_button = ui_root.get_node_or_null("SpawnInfantry")
	move_unit_button = ui_root.get_node_or_null("MoveUnit")
	end_phase_button = ui_root.get_node_or_null("EndPhase")
	end_turn_button = ui_root.get_node_or_null("EndTurn")
	event_log = ui_root.get_node_or_null("EventLog")


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


# ---------------------------------------------------------
# REGION SELECTION
# ---------------------------------------------------------
func _on_region_selected(region_id: String) -> void:
	_log_system("Selected region: %s" % region_id)


# ---------------------------------------------------------
# COMMAND HANDLERS
# ---------------------------------------------------------
func _on_spawn_infantry_pressed() -> void:
	var phase := _current_phase()

	if phase == "purchase":
		_apply_command("purchase_units", {
			"purchases": [
				{"unit_type_id": "infantry", "count": 1}
			]
		})
		_pending_spawn_count += 1
		_log_system("Purchased 1 infantry. Advance to mobilize phase to place.")

	elif phase == "mobilize":
		var region_id := _selected_region_id()
		if region_id.is_empty():
			_log_system("Select a region before placing units.")
			return

		var count := maxi(_pending_spawn_count, 1)
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
	var from_region := _selected_region_id()
	if from_region.is_empty():
		_log_system("Select a source region first.")
		return

	var to_region := ""
	if map_root and session:
		to_region = map_root.get_first_adjacent_region(
			from_region,
			session.state.adjacency
		)

	if to_region.is_empty():
		_log_system("No adjacent region found for %s." % from_region)
		return

	var faction_id := _selected_faction_id()
	if faction_id != str(session.state.current_faction_id):
		_log_system(
            "Move requires active faction %s (selector is %s)."
			% [
				GameSceneSessionBuilder.display_name_for_faction_id(
					str(session.state.current_faction_id)
				),
				_selected_faction_display()
			]
		)
		return

	var move_units := _first_movable_stack(from_region, faction_id)
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
		_log_system(
            "Command failed [%s]: %s"
			% [str(err.get("code", "UNKNOWN")), str(err.get("message", ""))]
		)

	_refresh_all()


# ---------------------------------------------------------
# SNAPSHOT → MAP + UNITS + UI
# ---------------------------------------------------------
func _refresh_all() -> void:
	_update_state_label()

	if session == null or map_root == null:
		return

	var snapshot := session.get_state()

	map_root.update_from_snapshot(snapshot)

	if unit_visualizer:
		unit_visualizer.refresh_from_snapshot(snapshot, map_root)


# ---------------------------------------------------------
# UI LABELS
# ---------------------------------------------------------
func _update_state_label() -> void:
	if state_label == null or session == null:
		return

	var snapshot := session.get_state()
	var turn_info = snapshot.get("turn_info", {})
	var ipc = snapshot.get("ipc", {})
	var faction_id := str(turn_info.get("current_faction_id", ""))
	var phase := str(turn_info.get("current_phase", ""))

	state_label.text = (
        "Turn %s  Round %s\nActive: %s  Phase: %s\nIPC  allies: %s  axis: %s\nSelected faction: %s"
		% [
			str(turn_info.get("turn_number", "?")),
			str(snapshot.get("game_round", "?")),
			GameSceneSessionBuilder.display_name_for_faction_id(faction_id),
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
	return GameSceneSessionBuilder.faction_id_from_display(
		faction_selector.get_item_text(faction_selector.selected)
	)


func _selected_faction_display() -> String:
	if faction_selector == null:
		return "Allies"
	return faction_selector.get_item_text(faction_selector.selected)


func _selected_region_id() -> String:
	if map_root == null:
		return ""
	return map_root.get_selected_region_id()


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


func _log_system(message: String) -> void:
	if event_log:
		event_log.append_text("[system] %s\n" % message)
