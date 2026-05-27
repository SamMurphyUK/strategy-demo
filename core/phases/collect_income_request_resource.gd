extends Resource
class_name CollectIncomeRequestResource

@export var command_id: String = ""
@export var faction_id: String = ""


static func from_command(cmd: Command, faction_id: String) -> CollectIncomeRequestResource:
	var request := CollectIncomeRequestResource.new()
	request.command_id = cmd.command_id
	request.faction_id = faction_id
	return request
