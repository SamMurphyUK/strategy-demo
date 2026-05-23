extends Resource
class_name CombatLoadTransportBatchResource

@export var command_id: String = ""
@export var faction_id: String = ""
@export var transport_instance_id: String = ""
@export var from_region_id: String = ""
@export var unit_lines: Array[CombatMoveUnitLineResource] = []


static func from_command(cmd: Command) -> CombatLoadTransportBatchResource:
	var batch := CombatLoadTransportBatchResource.new()
	batch.command_id = cmd.command_id
	batch.faction_id = cmd.player_id
	batch.transport_instance_id = str(cmd.payload.get("transport_instance_id", ""))
	batch.from_region_id = str(cmd.payload.get("from_region_id", ""))

	var raw_units: Array = cmd.payload.get("units", [])
	for unit_data in raw_units:
		if typeof(unit_data) != TYPE_DICTIONARY:
			continue
		batch.unit_lines.append(CombatMoveUnitLineResource.from_dict(unit_data))

	return batch


func to_payload() -> Dictionary:
	var units: Array = []
	for line in unit_lines:
		units.append(line.to_dict())
	return {
		"transport_instance_id": transport_instance_id,
		"from_region_id": from_region_id,
		"units": units,
	}
