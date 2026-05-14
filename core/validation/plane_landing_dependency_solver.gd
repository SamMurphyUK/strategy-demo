class_name PlaneLandingDependencySolver
extends RefCounted

const PlaneLandingRequirement := preload("res://core/validation/plane_landing_requirement.gd")

var state: GameState


func _init(p_state: GameState = null) -> void:
	state = p_state


func compute_plane_dependencies(batch, p_state: GameState, ruleset: Ruleset) -> Dictionary:
	state = p_state

	var deps: Dictionary = {}  # plane_id -> PlaneLandingRequirement

	for move in batch.moves:
		var unit: Unit = state.get_unit(move.unit_id) as Unit
		if unit == null:
			continue

		# Unit type data is a DICTIONARY, not a UnitType class
		var unit_type_data = state.unit_types.get(unit.unit_type)
		if unit_type_data == null:
			continue

		if unit_type_data.get("category", "") != "air":
			continue

		# Simple movement spent: path length or 0
		var movement_spent := 0
		if move.path is Array:
			movement_spent = move.path.size()

		var landing_zones: Array[String] = find_valid_landing_zones(
			unit.unit_type,
			state.current_faction_id,
			move.to_region,
			movement_spent
		)

		var dep := PlaneLandingRequirement.new()
		dep.unit_instance_id = str(unit.id)
		dep.current_region_id = move.to_region
		dep.movement_spent = movement_spent
		dep.possible_landing_regions = landing_zones

		deps[str(unit.id)] = dep

	return deps



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
