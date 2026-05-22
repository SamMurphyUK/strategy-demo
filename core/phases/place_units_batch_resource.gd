extends Resource
class_name PlaceUnitsBatchResource

@export var command_id: String = ""
@export var faction_id: String = ""
@export var entries: Array[PlaceUnitsEntryResource] = []


static func from_command(cmd: Command) -> PlaceUnitsBatchResource:
	var batch := PlaceUnitsBatchResource.new()
	batch.command_id = cmd.command_id
	batch.faction_id = cmd.player_id

	var raw_placements: Array = cmd.payload.get("placements", [])
	for placement_data in raw_placements:
		if typeof(placement_data) != TYPE_DICTIONARY:
			continue
		batch.entries.append(PlaceUnitsEntryResource.from_dict(placement_data))

	return batch


func to_payload() -> Dictionary:
	var placements: Array = []
	for entry in entries:
		placements.append(entry.to_dict())
	return {"placements": placements}
