extends Resource
class_name EndPhaseRequestResource

@export var command_id: String = ""
@export var faction_id: String = ""
@export var phase_at_request: String = ""


static func from_command(cmd: Command, current_phase: String) -> EndPhaseRequestResource:
	var request := EndPhaseRequestResource.new()
	request.command_id = cmd.command_id
	request.faction_id = cmd.player_id
	request.phase_at_request = current_phase
	return request
