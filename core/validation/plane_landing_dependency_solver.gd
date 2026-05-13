class_name PlaneLandingDependencySolver
extends RefCounted

var state: GameState


func _init(p_state: GameState = null) -> void:
	state = p_state


func find_valid_landing_zones(unit_type_id: String, faction_id: String, current_region_id: String, movement_spent: int) -> Array[String]:
	var valid_zones: Array[String] = []
	
	var u: Unit = state.unit_types.get(unit_type_id)
	if u == null or u.category != "air":
		return valid_zones
	
	var remaining_movement: int = u.movement - movement_spent
	
	var visited: Dictionary = {}
	var queue: Array = [[current_region_id, 0]]
	
	while queue.size() > 0:
		var current: Array = queue.pop_front()
		var region_id: String = current[0]
		var distance: int = current[1]
		
		if visited.has(region_id):
			continue
		visited[region_id] = true
		
		if distance > remaining_movement:
			continue
		
		var region: Region = state.regions.get(region_id)
		if region == null:
			continue
		
		if _is_valid_landing_zone(region, faction_id):
			valid_zones.append(region_id)
		
		var adj_regions: Array = state.adjacency.get(region_id, [])
		for adj_id in adj_regions:
			if not visited.has(adj_id):
				queue.append([adj_id, distance + 1])
	
	return valid_zones


func _is_valid_landing_zone(region: Region, faction_id: String) -> bool:
	if region.is_land_region():
		return region.owner_faction_id == faction_id
	
	return _has_carrier_capacity(region.id, faction_id)


func _has_carrier_capacity(region_id: String, faction_id: String) -> bool:
	var region_units: Array = state.region_units.get(region_id, [])
	var carrier_capacity := 0
	var planes_on_carriers := 0
	
	for unit_entry in region_units:
		if unit_entry.faction_id != faction_id:
			continue
		
		var u: Unit = state.unit_types.get(unit_entry.unit_type_id)
		if u == null:
			continue
		
		# FIX: Compare against unit_entry.unit_type_id (String), not u.id (int)
		if unit_entry.unit_type_id in ["carrier", "aircraft_carrier"]:
			var count: int = unit_entry.get("count", 1)
			carrier_capacity += count * 2
		elif u.category == "air":
			planes_on_carriers += unit_entry.get("count", 1)
	
	return planes_on_carriers < carrier_capacity


func validate_all_planes_can_land(faction_id: String, planned_moves: Array) -> Dictionary:
	var result := {
		"valid": true,
		"stranded_planes": []
	}
	
	for move in planned_moves:
		var unit_type_id: String = move.get("unit_type_id", "")
		var u: Unit = state.unit_types.get(unit_type_id)
		
		if u == null or u.category != "air":
			continue
		
		var destination: String = move.get("destination", "")
		var movement_spent: int = move.get("movement_spent", 0)
		
		var landing_zones := find_valid_landing_zones(unit_type_id, faction_id, destination, movement_spent)
		
		if landing_zones.size() == 0:
			result["valid"] = false
			result["stranded_planes"].append({
				"unit_type_id": unit_type_id,
				"position": destination
			})
	
	return result
