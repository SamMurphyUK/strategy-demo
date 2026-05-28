extends RefCounted
class_name GameSessionAdapter

var session  # GameSession or GameSessionStub
var debug: bool = false


func _init(p_session = null) -> void:
	session = p_session


static func from_session(session_instance) -> GameSessionAdapter:
	return GameSessionAdapter.new(session_instance)


func apply_command(cmd: Dictionary) -> Dictionary:
	if session == null:
		return {
			"result_type": "error",
			"error": {"code": "NO_SESSION", "message": "Session not set"},
			"events": [],
		}

	var type_name := str(cmd.get("type", "")).to_lower()
	var mapped := _map_command_type(type_name)
	if mapped != type_name:
		cmd = cmd.duplicate(true)
		cmd["type"] = mapped

	var result: Dictionary = session.apply_command(cmd)
	if str(result.get("result_type", "")) != "ok":
		return result

	var source_id := str(cmd.get("command_id", ""))
	var events: Array = []
	for raw in result.get("events", []):
		events.append(_to_canonical_event(raw, source_id))
	result["events"] = events
	return result


func get_state() -> Dictionary:
	if session == null:
		return {}
	if session.has_method("get_state"):
		return session.get_state()
	return {}


func get_legal_commands(player_id: String) -> Array:
	if session != null and session.has_method("get_legal_commands"):
		return session.get_legal_commands(player_id)
	return []


func await_controller_signal(
	controller: Object,
	success_signal: StringName,
	failure_signal: StringName,
	invoke: Callable
) -> Dictionary:
	var completed := false
	var outcome: Dictionary = {"success": false, "result": null}

	var on_success = func(result):
		completed = true
		outcome = {"success": true, "result": result}

	var on_failure = func(result):
		completed = true
		outcome = {"success": false, "result": result}

	if controller.has_signal(success_signal):
		controller.connect(success_signal, on_success, CONNECT_ONE_SHOT)
	if controller.has_signal(failure_signal):
		controller.connect(failure_signal, on_failure, CONNECT_ONE_SHOT)

	var sync_result = invoke.call()
	if completed:
		return outcome

	if sync_result != null:
		return {"success": true, "result": sync_result}

	await controller.get(success_signal)
	return outcome


static func validate_event_shape(evt: Dictionary) -> bool:
	return GameSessionStub.validate_event_shape(evt)


func _map_command_type(type_name: String) -> String:
	match type_name:
		"purchase_units", "place_units", "move_units", "end_phase", "end_turn", "collect_income":
			return type_name
		_:
			return type_name


func _to_canonical_event(raw, source_command_id: String) -> Dictionary:
	if raw is Dictionary:
		var d: Dictionary = raw.duplicate(true)
		if not d.has("source_command_id"):
			d["source_command_id"] = source_command_id
		d["type"] = _normalize_type(str(d.get("type", "")))
		if d.has("event_id"):
			d["event_id"] = str(d["event_id"]).replace("_", "")
		if not d.has("timestamp"):
			d["timestamp"] = int(Time.get_unix_time_from_system())
		return d

	if raw is GameEvent:
		return {
			"event_id": str(raw.event_id).replace("_", ""),
			"sequence": raw.sequence,
			"type": _normalize_type(GameEvent._type_to_string(raw.type)),
			"payload": raw.payload.duplicate(true),
			"source_command_id": source_command_id,
			"timestamp": int(Time.get_unix_time_from_system()),
		}

	return {}


func _normalize_type(type_name: String) -> String:
	return str(type_name).to_lower().replace("_", "")
