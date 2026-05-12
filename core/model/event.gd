class_name GameEvent
extends RefCounted

enum Type {
	PHASE_CHANGED,
	UNITS_PURCHASED,
	UNITS_MOVED,
	TRANSPORT_LOADED,
	TRANSPORT_UNLOADED,
	AMPHIBIOUS_DECLARED,
	AMPHIBIOUS_CANCELLED,
	BATTLE_STARTED,
	DICE_ROLLED,
	UNITS_DESTROYED,
	CARGO_DESTROYED,
	BATTLE_FINISHED,
	REGION_CAPTURED,
	UNITS_PLACED,
	PLACEMENT_FORFEITED,
	INCOME_COLLECTED,
	TURN_ENDED,
	GAME_FINISHED
}

var event_id: String
var sequence: int
var type: Type
var payload: Dictionary

static func create(evt_type: Type, evt_payload: Dictionary, seq: int) -> GameEvent:
	var evt := GameEvent.new()
	evt.event_id = "e_%05d" % seq
	evt.sequence = seq
	evt.type = evt_type
	evt.payload = evt_payload
	return evt

func to_dict() -> Dictionary:
	return {
		"event_id": event_id,
		"sequence": sequence,
		"type": _type_to_string(type),
		"payload": payload
	}

static func _type_to_string(t: Type) -> String:
	return Type.keys()[t].to_lower()
