extends Node2D
## Debug harness entry point. Gameplay flows through GameSessionBridge only.

@export var bridge: GameSessionBridge
@export var state_panel: UnitSpawnStatePanel
@export var unit_board_view: UnitBoardView


func _ready() -> void:
	_wire_harness_listeners()
	if bridge != null:
		bridge.emit_initial_snapshot()


func _wire_harness_listeners() -> void:
	if bridge == null:
		push_warning("UnitSpawnTest: bridge export is not assigned")
		return
	if state_panel != null and not bridge.state_snapshot_updated.is_connected(
		state_panel._on_state_snapshot_updated
	):
		bridge.state_snapshot_updated.connect(state_panel._on_state_snapshot_updated)
	if unit_board_view != null and not bridge.state_snapshot_updated.is_connected(
		unit_board_view._on_state_snapshot_updated
	):
		bridge.state_snapshot_updated.connect(unit_board_view._on_state_snapshot_updated)
	if state_panel != null:
		if not bridge.command_failed.is_connected(state_panel._on_command_failed):
			bridge.command_failed.connect(state_panel._on_command_failed)
		if not bridge.command_completed.is_connected(state_panel._on_command_completed):
			bridge.command_completed.connect(state_panel._on_command_completed)
