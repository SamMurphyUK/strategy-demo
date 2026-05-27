extends Resource
class_name PurchaseBatchResource

@export var command_id: String = ""
@export var faction_id: String = ""
@export var lines: Array[PurchaseLineResource] = []


static func from_command(cmd: Command) -> PurchaseBatchResource:
	var batch := PurchaseBatchResource.new()
	batch.command_id = cmd.command_id
	batch.faction_id = cmd.player_id

	var raw_purchases: Array = cmd.payload.get("purchases", [])
	if raw_purchases.is_empty():
		raw_purchases = cmd.payload.get("units", [])

	for entry in raw_purchases:
		if typeof(entry) != TYPE_DICTIONARY:
			continue
		batch.lines.append(PurchaseLineResource.from_dict(entry))

	return batch


func to_payload() -> Dictionary:
	var purchases: Array = []
	for line in lines:
		purchases.append(line.to_dict())
	return {"purchases": purchases}
