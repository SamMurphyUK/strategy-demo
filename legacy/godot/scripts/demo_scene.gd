extends Control
class_name DemoScene

var session: GameSession
var hud: HUD

const REGION_BUTTON_SCENE: PackedScene = preload("res://scenes/ui/RegionButton.tscn")

var selected_from: String = ""
var selected_to: String = ""

const DUPLICATE_WINDOW: float = 0.05
var _last_emit_id: String = ""
var _debounce_active: bool = false
var _debounce_timer: Timer


func _ready() -> void:
	await get_tree().process_frame

	hud = $HUD as HUD
	if hud == null:
		push_error("DemoScene: HUD node not found at $HUD")
		return

	hud.region_selected.connect(Callable(self, "on_region_selected"))

	_debounce_timer = Timer.new()
	_debounce_timer.one_shot = true
	_debounce_timer.wait_time = DUPLICATE_WINDOW
	add_child(_debounce_timer)
	_debounce_timer.timeout.connect(Callable(self, "_on_debounce_timeout"))

	hud.set_info("Select origin region", 0.0, 0.0)


# ---------------------------------------------------------
# JSON LOADER
# ---------------------------------------------------------
func _load_json_optional(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}

	var text: String = FileAccess.get_file_as_string(path)
	var parsed: Variant = JSON.parse_string(text)


	if parsed.error != OK:
		push_error("Failed to parse JSON: %s (err %d)" % [path, parsed.error])
		return {}

	return parsed.result


# ---------------------------------------------------------
# SCENARIO LOADING
# ---------------------------------------------------------
func load_scenario(path: String) -> void:
	if not path.ends_with("/"):
		path += "/"

	var map_data: Dictionary = _load_json_optional(path + "map.json")
	var units_data: Dictionary = _load_json_optional(path + "units.json")
	var factions_data: Dictionary = _load_json_optional(path + "factions.json")
	var setup_data: Dictionary = _load_json_optional(path + "setup.json")
	var rules_data: Dictionary = _load_json_optional(path + "rules.json")
	var rng_seed: Dictionary = _load_json_optional(path + "rng_seed.json")

	if rng_seed.is_empty():
		rng_seed = { "seed": int(Time.get_unix_time_from_system()) }

	session = GameSession.create(
		map_data,
		units_data,
		factions_data,
		setup_data,
		rules_data,
		rng_seed
	)

	var positions: Dictionary = _load_json_optional(path + "positions.json")

	if session != null and session.state != null:
		hud.load_regions_from_state(session.state, positions)
	else:
		push_error("DemoScene.load_scenario: session or session.state is null")


# ---------------------------------------------------------
# REGION SELECTION
# ---------------------------------------------------------
func on_region_selected(region_id: String) -> void:
	var id: String = region_id.strip_edges()
	if id == "":
		return

	if _debounce_active and id == _last_emit_id:
		return

	_last_emit_id = id
	_debounce_active = true
	_debounce_timer.start()

	if selected_from == "":
		_select_from(id)
	else:
		_select_to(id)


func _on_debounce_timeout() -> void:
	_debounce_active = false


func _select_from(region_id: String) -> void:
	selected_from = region_id
	hud.reset_all_highlights()
	hud.highlight_region(region_id, true)

	if session != null and session.state != null:
		hud.highlight_adjacent(region_id, session.state.adjacency, true)

	hud.set_info("From: %s — select adjacent region" % region_id, 0.0, 0.0)


func _select_to(region_id: String) -> void:
	if region_id == selected_from:
		hud.set_info("Select a different destination", 1.0, 0.5)
		return

	if not _is_valid_destination(region_id):
		hud.set_info("Invalid destination: %s" % region_id, 1.0, 0.5)
		selected_to = ""
		return

	selected_to = region_id
	hud.set_info("From: %s → To: %s" % [selected_from, selected_to], 1.5, 1.0)

	var cmd: Dictionary = {
		"type": "move_units",
		"playerid": session.state.current_faction_id,
		"payload": {
			"from": selected_from,
			"to": selected_to,
			"units": []
		}
	}

	if session != null and session.has_method("apply_command"):
		session.apply_command(cmd)
	else:
		push_error("DemoScene: session.apply_command not found")

	_on_move_committed(selected_from, selected_to)
	_reset_selection()


func _is_valid_destination(region_id: String) -> bool:
	if session == null or session.state == null:
		return false
	if not session.state.adjacency.has(selected_from):
		return false
	return region_id in session.state.adjacency[selected_from]


# ---------------------------------------------------------
# VISUAL UPDATES
# ---------------------------------------------------------
func _on_move_committed(from_id: String, to_id: String) -> void:
	hud.highlight_region(to_id, true)

	if session != null and session.state != null:
		if session.state.regions.has(from_id):
			hud.update_region_visual(from_id, session.state.regions[from_id])
		if session.state.regions.has(to_id):
			hud.update_region_visual(to_id, session.state.regions[to_id])


func _reset_selection() -> void:
	selected_from = ""
	selected_to = ""
	hud.reset_all_highlights()
	hud.set_info("Select origin region", 0.0, 0.0)
