class_name Region
extends RefCounted

var id: String
var name: String
var type: String              # "land" or "sea"
var ipc_value: int
var owner_faction_id: String
var is_capital: bool
var has_factory: bool
var adjacent: Array[String] = []


static func from_dict(data: Dictionary) -> Region:
	var region := Region.new()
	region.id = str(data.get("id", ""))
	region.name = str(data.get("name", ""))
	region.type = str(data.get("type", "land"))
	region.ipc_value = int(data.get("ipc_value", 0))
	region.owner_faction_id = str(data.get("owner_faction_id", ""))
	region.is_capital = bool(data.get("is_capital", false))
	region.has_factory = bool(data.get("has_factory", false))
	
	var adj = data.get("adjacent", [])
	region.adjacent = []
	for a in adj:
		region.adjacent.append(str(a))
	
	return region


func is_land_region() -> bool:
	return type == "land"


func is_sea_region() -> bool:
	return type == "sea"


func to_dict() -> Dictionary:
	return {
		"id": id,
		"name": name,
		"type": type,
		"ipc_value": ipc_value,
		"owner_faction_id": owner_faction_id,
		"is_capital": is_capital,
		"has_factory": has_factory,
		"adjacent": adjacent
	}
