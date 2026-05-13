class_name PlacementValidator
extends RefCounted

var state: GameState


func _init(p_state: GameState = null) -> void:
	state = p_state


func validate_placement(faction_id: String, region_id: String, unit_type_id: String, count: int = 1) -> Dictionary:
	var result := {"valid": true, "errors": []}
	
	var region: Region = state.regions.get(region_id)
	if region == null:
		result["valid"] = false
		result["errors"].append("Region does not exist: %s" % region_id)
		return result
	
	if not region.has_factory:
		result["valid"] = false
		result["errors"].append("Region has no factory: %s" % region_id)
		return result
	
	if region.owner_faction_id != faction_id:
		result["valid"] = false
		result["errors"].append("Region not owned by faction: %s" % region_id)
		return result
	
	var u: Unit = state.unit_types.get(unit_type_id)
	if u == null:
		result["valid"] = false
		result["errors"].append("Unknown unit type: %s" % unit_type_id)
		return result
	
	var capacity := _get_factory_capacity(region)
	var already_placed := _get_placed_count(faction_id, region_id)
	
	if already_placed + count > capacity:
		result["valid"] = false
		result["errors"].append("Exceeds factory capacity: %d + %d > %d" % [already_placed, count, capacity])
	
	return result


func _get_factory_capacity(region: Region) -> int:
	var capacity: int = region.ipc_value
	
	if region.is_capital and state.rules.get("capital_production_bonus", false):
		capacity += state.rules.get("capital_bonus_amount", 2)
	
	return capacity


func _get_placed_count(faction_id: String, region_id: String) -> int:
	var pending: Array = state.pending_purchases.get(faction_id, [])
	var count := 0
	
	for p in pending:
		if p.get("placed_region_id") == region_id:
			count += p.get("count", 1)
	
	return count


func get_valid_placement_regions(faction_id: String) -> Array[String]:
	var regions: Array[String] = []
	
	for region_id in state.regions.keys():
		var region: Region = state.regions[region_id]
		
		if region.owner_faction_id == faction_id and region.has_factory:
			regions.append(region_id)
	
	return regions
