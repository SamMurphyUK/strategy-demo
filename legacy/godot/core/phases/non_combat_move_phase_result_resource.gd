extends Resource
class_name NonCombatMovePhaseResultResource

@export var success: bool = false
@export var error_code: String = ""
@export var error_message: String = ""

var game_events: Array = []


func get_events() -> Array:
	return game_events


func to_event_dicts() -> Array:
	return game_events.map(func(e: GameEvent) -> Dictionary: return e.to_dict())
