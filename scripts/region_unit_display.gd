class_name RegionUnitDisplay
extends RefCounted

const MOVEMENT_PHASES := ["combat_move", "noncombat_move"]


static func build_display_entries(units_array: Array) -> Array:
	var entries: Array = []
	var stacks := {}
	for u in units_array:
		if typeof(u) != TYPE_DICTIONARY:
			continue
		var parsed := UnitTextureCache.normalize_unit_type_and_faction(
			str(u.get("unit_type_id", "")),
			str(u.get("faction_id", ""))
		)
		var unit_type := str(parsed["unit_type_id"])
		if unit_type.is_empty():
			continue
		var faction_id := str(parsed["faction_id"])
		if u.has("instance_id") and not str(u.get("instance_id", "")).is_empty():
			entries.append({
				"unit_type_id": unit_type,
				"faction_id": faction_id,
				"count": int(u.get("count", 1)),
				"instance_id": str(u.get("instance_id", "")),
			})
			continue
		var stack_key := "%s|%s" % [unit_type, faction_id]
		if not stacks.has(stack_key):
			stacks[stack_key] = {
				"unit_type_id": unit_type,
				"faction_id": faction_id,
				"count": 0,
			}
		stacks[stack_key]["count"] = int(stacks[stack_key]["count"]) + int(u.get("count", 0))
	for stack_entry in stacks.values():
		entries.append(stack_entry)
	return entries


static func entries_for_region_inspector(
	state: GameState,
	region_id: String,
	viewer_faction: String
) -> Array:
	if state == null or region_id.is_empty():
		return []
	var owner := state.get_region_owner(region_id)
	var units := state.get_units_in_region(region_id)
	if owner == viewer_faction:
		return _owned_friendly_entries(state, region_id, viewer_faction, units)
	return _hostile_region_entries(state, region_id, viewer_faction, owner, units)


static func combat_pool_entries(
	state: GameState,
	region_id: String,
	attacker_faction: String
) -> Array:
	if state == null or region_id.is_empty():
		return []
	if not state.is_region_hostile_to(region_id, attacker_faction):
		return []
	return build_display_entries(state.get_faction_units_in_region(region_id, attacker_faction))


static func combat_pool_unit_count(
	state: GameState,
	region_id: String,
	attacker_faction: String
) -> int:
	var total := 0
	for entry in combat_pool_entries(state, region_id, attacker_faction):
		total += int(entry.get("count", 0))
	return total


static func regions_with_combat_pools(state: GameState, attacker_faction: String) -> Array:
	var result: Array = []
	if state == null:
		return result
	for region_id in state.region_units.keys():
		if combat_pool_unit_count(state, str(region_id), attacker_faction) > 0:
			result.append(str(region_id))
	result.sort()
	return result


static func _owned_friendly_entries(
	state: GameState,
	_region_id: String,
	faction: String,
	units: Array
) -> Array:
	var faction_units: Array = []
	for u in units:
		if typeof(u) != TYPE_DICTIONARY:
			continue
		if str(u.get("faction_id", "")) != faction:
			continue
		faction_units.append(u)
	var entries := build_display_entries(faction_units)
	if state.current_phase not in MOVEMENT_PHASES:
		return entries
	var filtered: Array = []
	for entry in entries:
		if entry.has("instance_id") and not str(entry.get("instance_id", "")).is_empty():
			if state.has_instance_moved(str(entry.get("instance_id", ""))):
				continue
		filtered.append(entry)
	return filtered


static func _hostile_region_entries(
	state: GameState,
	region_id: String,
	viewer_faction: String,
	owner: String,
	units: Array
) -> Array:
	var display_faction := owner if not owner.is_empty() else viewer_faction
	var filtered_units: Array = []
	for u in units:
		if typeof(u) != TYPE_DICTIONARY:
			continue
		if str(u.get("faction_id", "")) == display_faction:
			filtered_units.append(u)
	if filtered_units.is_empty():
		for u in units:
			if typeof(u) != TYPE_DICTIONARY:
				continue
			if str(u.get("faction_id", "")) != viewer_faction:
				filtered_units.append(u)
	return build_display_entries(filtered_units)


static func is_container_unit(state: GameState, unit_type_id: String) -> bool:
	if state == null or unit_type_id.is_empty():
		return false
	var unit: Unit = state.unit_types.get(unit_type_id)
	return unit != null and unit.container is Dictionary and not unit.container.is_empty()


static func cargo_summary_lines(state: GameState, instance_id: String) -> Array:
	if state == null or instance_id.is_empty():
		return ["Empty"]
	var transport_data: Dictionary = state.transport_instances.get(instance_id, {})
	var cargo: Array = transport_data.get("cargo", [])
	if cargo.is_empty():
		return ["Empty"]
	var lines: Array = []
	for entry in cargo:
		if typeof(entry) != TYPE_DICTIONARY:
			continue
		var unit_type := str(entry.get("unit_type_id", ""))
		var count := int(entry.get("count", 0))
		if unit_type.is_empty() or count <= 0:
			continue
		lines.append("%s × %d" % [unit_type.capitalize(), count])
	return lines if not lines.is_empty() else ["Empty"]

