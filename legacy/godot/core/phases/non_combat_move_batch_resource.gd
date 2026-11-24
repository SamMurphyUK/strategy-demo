extends Resource
class_name NonCombatMoveBatchResource

@export var command_id: String = ""
@export var faction_id: String = ""
@export var moves: Array[NonCombatMoveEntryResource] = []


static func from_command(cmd: Command) -> NonCombatMoveBatchResource:
	var batch := NonCombatMoveBatchResource.new()
	batch.command_id = cmd.command_id
	batch.faction_id = cmd.player_id

	var raw_moves: Array = cmd.payload.get("moves", [])
	for move_data in raw_moves:
		if typeof(move_data) != TYPE_DICTIONARY:
			continue
		batch.moves.append(NonCombatMoveEntryResource.from_dict(move_data))

	return batch


func to_payload() -> Dictionary:
	var move_dicts: Array = []
	for move in moves:
		move_dicts.append(move.to_dict())
	return {"moves": move_dicts}
