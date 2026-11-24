extends Resource
class_name EndPhaseResultResource

@export var success: bool = true

var game_events: Array = []


func get_events() -> Array:
	return game_events


func to_event_dicts() -> Array:
	return game_events.map(func(e: GameEvent) -> Dictionary: return e.to_dict())
