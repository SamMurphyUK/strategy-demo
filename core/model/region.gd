class_name Region
extends RefCounted

var id: String
var name: String
var type: String
var ipc_value: int
var owner_faction_id: String
var is_capital: bool
var has_factory: bool

static func from_dict(data: Dictionary) -> Region:
	var region := Region.new()
	region.id = data.get("id", "")
	region.name = data.get("name", "")
	region.type = data.get("type", "")
	region.ipc_value = data.get("ipc_value", 0)
	region.owner_faction_id = data.get("owner_faction_id", "")
	region.is_capital = data.get("is_capital", false)
	region.has_factory = data.get("has_factory", false)
	return region

func is_land() -> bool:
	return type == "land"

func is_sea() -> bool:
	return type == "sea"