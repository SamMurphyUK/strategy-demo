extends Resource
class_name StartTurnRequestResource

@export var command_id: String = ""


static func for_game_bootstrap() -> StartTurnRequestResource:
	return StartTurnRequestResource.new()
