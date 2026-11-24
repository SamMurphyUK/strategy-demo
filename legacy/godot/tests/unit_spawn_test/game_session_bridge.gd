extends Node
class_name GameSessionBridge

signal state_snapshot_updated(snapshot: Dictionary)
signal command_completed(result: Dictionary)
signal command_failed(error_code: String, error_message: String)

@export var scenario_paths: ScenarioPathsResource

var session: GameSession
var _command_counter: int = 0


func _ready() -> void:
	if scenario_paths == null:
		scenario_paths = ScenarioPathsResource.new()
	_load_minimal_scenario()
	_start_game()


func emit_initial_snapshot() -> void:
	_emit_initial_snapshot()


func _load_minimal_scenario() -> void:
	session = GameSession.create(
		_load_json(scenario_paths.map_path),
		_load_json(scenario_paths.units_path),
		_load_json(scenario_paths.factions_path),
		_load_json(scenario_paths.setup_path),
		_load_json(scenario_paths.rules_path),
		{
			"state": scenario_paths.rng_state,
			"sequence": scenario_paths.rng_sequence,
		}
	)


func _start_game() -> void:
	if session == null:
		push_error("GameSessionBridge: session not loaded")
		return
	if session.turn_engine == null:
		push_error("GameSessionBridge: turn engine missing")
		return
	# GameSession.create() invokes TurnEngine.start_game() during _init_session.
	# Harness calls it explicitly when boot did not initialise the turn (GUT parity).
	if session.state.current_phase.is_empty() or session.state.current_faction_id.is_empty():
		session.turn_engine.start_game()


func _load_json(path: String) -> Dictionary:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		push_error("GameSessionBridge: failed to open %s" % path)
		return {}
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	file.close()
	if typeof(parsed) != TYPE_DICTIONARY:
		push_error("GameSessionBridge: invalid JSON in %s" % path)
		return {}
	return parsed as Dictionary


func _next_command_id() -> String:
	_command_counter += 1
	return "usc_%04d" % _command_counter


func _current_player_id() -> String:
	if session == null:
		return ""
	return session.state.current_faction_id


func _apply_typed_command(type_name: String, payload: Dictionary) -> void:
	if session == null:
		command_failed.emit("NO_SESSION", "Game session is not initialised")
		return

	var command: Dictionary = {
		"command_id": _next_command_id(),
		"player_id": _current_player_id(),
		"type": type_name,
		"payload": payload,
	}

	var result: Dictionary = session.apply_command(command)

	if str(result.get("result_type", "")) == "ok":
		command_completed.emit(result)
		state_snapshot_updated.emit(session.get_state())
	else:
		var err: Dictionary = result.get("error", {})
		command_failed.emit(
			str(err.get("code", "UNKNOWN")),
			str(err.get("message", "Command rejected"))
		)


func _emit_initial_snapshot() -> void:
	if session == null:
		return
	state_snapshot_updated.emit(session.get_state())


func on_purchase_units_requested(purchases: Array) -> void:
	_apply_typed_command("purchase_units", {"purchases": purchases})


func on_move_units_requested(moves: Array) -> void:
	_apply_typed_command("move_units", {"moves": moves})


func on_place_units_requested(placements: Array) -> void:
	_apply_typed_command("place_units", {"placements": placements})


func on_end_phase_requested() -> void:
	_apply_typed_command("end_phase", {})


func on_end_turn_requested() -> void:
	_apply_typed_command("end_turn", {})
