class_name Region
extends RefCounted

var id: String
var name: String
var type: String              # "land" or "sea"
var ipc_value: int
var owner_faction_id: String
var is_capital: bool
var has_factory: bool

var is_land: bool = false
var adjacent: Array[String] = []

static func from_dict(data: Dictionary) -> Region:
	var region := Region.new()
	region.id = data.get("id", "")
	region.name = data.get("name", "")
	region.type = data.get("type", "")
	region.ipc_value = data.get("ipc_value", 0)
	region.owner_faction_id = data.get("owner_faction_id", "")
	region.is_capital = data.get("is_capital", false)
	region.has_factory = data.get("has_factory", false)

	if data.has("is_land"):
		region.is_land = bool(data["is_land"])
	else:
		region.is_land = (region.type == "land")

	region.adjacent = data.get("adjacent", [])

	return region

func is_land_region() -> bool:
	return is_land

func is_sea_region() -> bool:
	return not is_land
