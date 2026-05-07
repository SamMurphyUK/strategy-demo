class_name CommandValidator
extends RefCounted

const PHASE_COMMANDS := {
	"purchase": [Command.Type.PURCHASE_UNITS, Command.Type.END_PHASE],
	"combat_move": [Command.Type.MOVE_UNITS, Command.Type.LOAD_TRANSPORT, Command.Type.DESIGNATE_AMPHIBIOUS, Command.Type.END_PHASE],
	"combat": [],
	"noncombat_move": [Command.Type.MOVE_UNITS, Command.Type.LOAD_TRANSPORT, Command.Type.UNLOAD_TRANSPORT, Command.Type.END_PHASE],
	"mobilize": [Command.Type.PLACE_UNITS, Command.Type.END_PHASE],
	"collect_income": [Command.Type.END_TURN]
}

var state: GameState
var error_code: String = ""
var error_message: String = ""

func _init(game_state: GameState) -> void:
	state = game_state

func validate(command: Command) -> bool:
	error_code = ""
	error_message = ""
	if command.player_id != state.current_faction_id:
		error_code = "OUT_OF_TURN"
		error_message = "Not your turn"
		return false
	var legal: Array = PHASE_COMMANDS.get(state.current_phase, [])
	if command.type not in legal:
		error_code = "ILLEGAL_ACTION"
		error_message = "Command not allowed in phase"
		return false
	return true

func get_error() -> Dictionary:
	return {"code": error_code, "message": error_message}