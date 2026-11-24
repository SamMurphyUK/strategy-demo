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
var turn_order: Array = [] # ← untyped to accept JSON array
var rules: Dictionary = {}
var region_units: Dictionary = {}
var ipc: Dictionary = {}
var pending_purchases: Dictionary = {}
var pending_amphibious_assaults: Array = []
var factories_controlled_at_turn_start: Dictionary = {}
var next_instance_id: Dictionary = {}
var transport_instances: Dictionary = {}
var game_over: bool = false
var winner_faction_id: String = ""
# Units that arrived in a region during the current movement window (combat + noncombat).
var units_arrived_this_phase: Dictionary = {}
var units_embarked_this_phase: Dictionary = {}
# Container instances that already spent movement this window.
var instances_moved_this_phase: Dictionary = {}

# ---------------------------------------------------------
# REGION + ADJACENCY HELPERS
# ---------------------------------------------------------

func get_adjacent_regions(region_id: String) -> Array:
	return adjacency.get(region_id, [])

func is_adjacent(from_id: String, to_id: String) -> bool:
	return to_id in get_adjacent_regions(from_id)

func get_region_owner(region_id: String) -> String:
	var region: Region = regions.get(region_id)
	return region.owner_faction_id if region else ""

func set_region_owner(region_id: String, faction_id: String) -> void:
	var region: Region = regions.get(region_id)
	if region:
		region.owner_faction_id = faction_id

# ---------------------------------------------------------
# REGION TYPE + OWNERSHIP HELPERS
# ---------------------------------------------------------

func is_region_land(region_id: String) -> bool:
	var region: Region = regions.get(region_id)
	return region != null and region.type == "land"

func is_region_owned_by(region_id: String, faction_id: String) -> bool:
	var region: Region = regions.get(region_id)
	return region != null and region.owner_faction_id == faction_id


func is_region_hostile_to(region_id: String, faction_id: String) -> bool:
	var region: Region = regions.get(region_id)
	if region == null:
		return true
	var owner := str(region.owner_faction_id)
	if owner != "" and owner != faction_id:
		return true
	for entry in get_units_in_region(region_id):
		if str(entry.get("faction_id", "")) != faction_id:
			return true
	return false


func movement_stack_key(faction_id: String, region_id: String, unit_type_id: String) -> String:
	return "%s|%s|%s" % [faction_id, region_id, unit_type_id]


func movable_stack_count(faction_id: String, region_id: String, unit_type_id: String) -> int:
	var total := 0
	for entry in get_faction_units_in_region(region_id, faction_id):
		if str(entry.get("unit_type_id", "")) == unit_type_id and not entry.has("instance_id"):
			total += int(entry.get("count", 0))
	var arrived := int(
		units_arrived_this_phase.get(movement_stack_key(faction_id, region_id, unit_type_id), 0)
	)
	var embarked := int(
		units_embarked_this_phase.get(movement_stack_key(faction_id, region_id, unit_type_id), 0)
	)
	return maxi(0, total - arrived - embarked)


func record_stack_embark(
	faction_id: String,
	region_id: String,
	unit_type_id: String,
	count: int
) -> void:
	var key := movement_stack_key(faction_id, region_id, unit_type_id)
	units_embarked_this_phase[key] = int(units_embarked_this_phase.get(key, 0)) + count


func record_stack_arrival(
	faction_id: String,
	region_id: String,
	unit_type_id: String,
	count: int
) -> void:
	var key := movement_stack_key(faction_id, region_id, unit_type_id)
	units_arrived_this_phase[key] = int(units_arrived_this_phase.get(key, 0)) + count


func has_instance_moved(instance_id: String) -> bool:
	return bool(instances_moved_this_phase.get(instance_id, false))


func record_instance_moved(instance_id: String) -> void:
	instances_moved_this_phase[instance_id] = true


func clear_movement_phase_tracking() -> void:
	units_arrived_this_phase.clear()
	units_embarked_this_phase.clear()
	instances_moved_this_phase.clear()

# ---------------------------------------------------------
# IPC + ECONOMY
# ---------------------------------------------------------

func get_faction_ipc(faction_id: String) -> int:
	return ipc.get(faction_id, 0)

func modify_ipc(faction_id: String, amount: int) -> void:
	ipc[faction_id] = ipc.get(faction_id, 0) + amount

# ---------------------------------------------------------
# INSTANCE ID GENERATION
# ---------------------------------------------------------

func generate_instance_id(unit_type_id: String, faction_id: String) -> String:
	var key := unit_type_id + "_" + faction_id
	var seq: int = next_instance_id.get(key, 1)
	next_instance_id[key] = seq + 1
	return "%s_%s_%03d" % [unit_type_id, faction_id, seq]

# ---------------------------------------------------------
# UNIT LOOKUP HELPERS (dictionary-based)
# ---------------------------------------------------------

func get_units_in_region(region_id: String) -> Array:
	return region_units.get(region_id, [])

func get_faction_units_in_region(region_id: String, faction_id: String) -> Array:
	var result: Array = []
	for entry in get_units_in_region(region_id):
		if entry.get("faction_id") == faction_id:
			result.append(entry)
	return result

func get_enemy_units_in_region(region_id: String, faction_id: String) -> Array:
	var result: Array = []
	for entry in get_units_in_region(region_id):
		if entry.get("faction_id") != faction_id:
			result.append(entry)
	return result

func get_unit(id: int) -> Dictionary:
	for region_id in region_units.keys():
		for entry in region_units[region_id]:
			if entry.get("id") == id:
				return entry
	return {}

func get_unit_region(id: int) -> String:
	for region_id in region_units.keys():
		for entry in region_units[region_id]:
			if entry.get("id") == id:
				return region_id
	return ""

func get_units_for_faction(faction_id: String) -> Array:
	var result: Array = []
	for region_id in region_units.keys():
		for entry in region_units[region_id]:
			if entry.get("faction_id") == faction_id:
				result.append(entry)
	return result

# ---------------------------------------------------------
# SNAPSHOT SERIALISATION
# ---------------------------------------------------------

func to_snapshot() -> Dictionary:
	var region_data: Array = []
	for region_id in regions:
		region_data.append({
			"region_id": region_id,
			"owner_faction_id": regions[region_id].owner_faction_id,
			"units": get_units_in_region(region_id)
		})
	return {
		"game_round": game_round,
		"turn_info": {
			"current_faction_id": current_faction_id,
			"current_phase": current_phase,
			"turn_number": turn_number
		},
		"regions": region_data,
		"ipc": ipc.duplicate(),
		"pending_purchases": pending_purchases.duplicate(true),
		"pending_amphibious_assaults": pending_amphibious_assaults.duplicate(true),
		"game_over": game_over,
		"winner_faction_id": winner_faction_id
	}
