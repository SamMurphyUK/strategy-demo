class_name PCG
extends RefCounted

var _state: int
var _sequence: int

const MULTIPLIER: int = 6364136223846793005


func _init(p_state: int, p_sequence: int) -> void:
	_sequence = (p_sequence << 1) | 1
	_state = 0
	_advance()
	_state = (_state + p_state) & 0x7FFFFFFFFFFFFFFF
	_advance()


func _advance() -> void:
	_state = ((_state * MULTIPLIER) + _sequence) & 0x7FFFFFFFFFFFFFFF


func next_int() -> int:
	var old_state := _state
	_advance()
	
	var xorshifted: int = (((old_state >> 18) ^ old_state) >> 27) & 0xFFFFFFFF
	var rot: int = (old_state >> 59) & 0x1F
	
	var result: int
	if rot == 0:
		result = xorshifted
	else:
		result = ((xorshifted >> rot) | (xorshifted << (32 - rot))) & 0xFFFFFFFF
	
	return result


func roll_d6() -> int:
	var max_valid: int = 0xFFFFFFFF - (0xFFFFFFFF % 6) - 1
	var r: int = next_int()
	while r > max_valid:
		r = next_int()
	return (r % 6) + 1


func get_state() -> Dictionary:
	return {"state": _state, "sequence": _sequence}


static func from_seed(seed_dict: Dictionary) -> PCG:
	return PCG.new(seed_dict.state, seed_dict.sequence)
