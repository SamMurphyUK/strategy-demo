class_name GameState
extends RefCounted

var game_round: int = 1
var current_faction_id: String = ""
var current_phase: String = ""
var turn_number: int = 1
var unit_types: Dictionary = {}
var factions: Dictionary = {}
var regions: Dictionary = {}
var adjacency: Dictionary = {}
var turn_order: Array = []
var rules: Dictionary = {}
var region_units: Dictionary = {}
var ipc: Dictionary = {}
var pending_purchases: Dictionary = {}
var pending_amphibious_assaults: Array = []
var factories_controlled_at_turn_start: Dictionary = {}
var next_instance_id: Dictionary = {}
var transport_instances: Dictionary = {}
var game_over: bool = false
var winner: String = ""

func get_adjacent_regions(region_id: String) -> Array:
	return adjacency.get(region_id, [])

func is_adjacent(from_id: String, to_id: String) -> bool:
	return to_id in get_adjacent_regions(from_id)

func get_region_owner(region_id: String) -> String:
	var region: Region = regions.get(region_id)
	return region.owner_faction_id if region else ""

func set_region_owner(region_id: String, faction_id: String) -> void:
	var region: Region = regions.get(region_id)
	if region: region.owner_faction_id = faction_id

func get_faction_ipc(faction_id: String) -> int:
	return ipc.get(faction_id, 0)

func modify_ipc(faction_id: String, amount: int) -> void:
	ipc[faction_id] = ipc.get(faction_id, 0) + amount

func generate_instance_id(unit_type_id: String, faction_id: String) -> String:
	var key := unit_type_id + "_" + faction_id
	var seq: int = next_instance_id.get(key, 1)
	next_instance_id[key] = seq + 1
	return "%s_%s_%03d" % [unit_type_id, faction_id, seq]

func get_units_in_region(region_id: String) -> Array:
	return region_units.get(region_id, [])

func get_faction_units_in_region(region_id: String, faction_id: String) -> Array:
	var result: Array = []
	for entry in get_units_in_region(region_id):
		if entry.get("faction_id") == faction_id: result.append(entry)
	return result

func get_enemy_units_in_region(region_id: String, faction_id: String) -> Array:
	var result: Array = []
	for entry in get_units_in_region(region_id):
		if entry.get("faction_id") != faction_id: result.append(entry)
	return result

func to_snapshot() -> Dictionary:
	var region_data: Array = []
	for region_id in regions:
		region_data.append({"region_id": region_id, "owner_faction_id": regions[region_id].owner_faction_id, "units": get_units_in_region(region_id)})
	return {"game_round": game_round, "turn_info": {"current_faction_id": current_faction_id, "current_phase": current_phase, "turn_number": turn_number}, "regions": region_data, "ipc": ipc.duplicate(), "pending_purchases": pending_purchases.duplicate(true), "pending_amphibious_assaults": pending_amphibious_assaults.duplicate(true), "game_over": game_over, "winner": winner}