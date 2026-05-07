class_name PCG
extends RefCounted

var _state: int
var _sequence: int
const MULTIPLIER := 6364136223846793005

func _init(state: int, sequence: int) -> void:
	_sequence = (sequence << 1) | 1
	_state = 0
	_advance()
	_state += state
	_advance()

func _advance() -> void:
	_state = _state * MULTIPLIER + _sequence

func next_int() -> int:
	var old_state := _state
	_advance()
	var xorshifted := ((old_state >> 18) ^ old_state) >> 27
	var rot := old_state >> 59
	return (xorshifted >> rot) | (xorshifted << ((-rot) & 31)) & 0xFFFFFFFF

func roll_d6() -> int:
	return (next_int() % 6) + 1

func get_state() -> Dictionary:
	return {"state": _state, "sequence": _sequence}

static func from_seed(seed_dict: Dictionary) -> PCG:
	return PCG.new(seed_dict.state, seed_dict.sequence)