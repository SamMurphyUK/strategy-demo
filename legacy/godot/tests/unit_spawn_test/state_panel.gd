extends Control
class_name UnitSpawnStatePanel

@export var bridge: GameSessionBridge
@export var labels_box: VBoxContainer


func _ready() -> void:
	_connect_bridge()


func _connect_bridge() -> void:
	if bridge == null:
		push_warning("UnitSpawnStatePanel: bridge export is not assigned")
		return
	if not bridge.state_snapshot_updated.is_connected(_on_state_snapshot_updated):
		bridge.state_snapshot_updated.connect(_on_state_snapshot_updated)
	if not bridge.command_failed.is_connected(_on_command_failed):
		bridge.command_failed.connect(_on_command_failed)
	if not bridge.command_completed.is_connected(_on_command_completed):
		bridge.command_completed.connect(_on_command_completed)


func _label_at(index: int) -> Label:
	if labels_box == null or labels_box.get_child_count() <= index:
		return null
	return labels_box.get_child(index) as Label


func _on_state_snapshot_updated(snapshot: Dictionary) -> void:
	var turn_info: Dictionary = snapshot.get("turn_info", {})
	var faction_label := _label_at(0)
	if faction_label != null:
		faction_label.text = "Faction: %s" % str(turn_info.get("current_faction_id", ""))
	var phase_label := _label_at(1)
	if phase_label != null:
		phase_label.text = "Phase: %s" % str(turn_info.get("current_phase", ""))
	var turn_label := _label_at(2)
	if turn_label != null:
		turn_label.text = "Turn %d  Round %d" % [
			int(turn_info.get("turn_number", 0)),
			int(snapshot.get("game_round", 0)),
		]
	var ipc_label := _label_at(3)
	if ipc_label != null:
		var ipc: Dictionary = snapshot.get("ipc", {})
		ipc_label.text = "IPC  red: %s  blue: %s" % [
			str(ipc.get("red", 0)),
			str(ipc.get("blue", 0)),
		]
	var error_label := _label_at(4)
	if error_label != null:
		error_label.text = ""


func _on_command_completed(_result: Dictionary) -> void:
	var error_label := _label_at(4)
	if error_label != null:
		error_label.text = ""


func _on_command_failed(error_code: String, error_message: String) -> void:
	var error_label := _label_at(4)
	if error_label != null:
		error_label.text = "%s: %s" % [error_code, error_message]
