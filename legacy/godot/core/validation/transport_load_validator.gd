extends RefCounted
class_name TransportLoadValidator

const VT := preload("res://core/validation/validation_types.gd")


func get_legal_load_destinations(
	from_region: String,
	unit_type_id: String,
	faction_id: String,
	state: GameState
) -> Array[String]:
	var legal: Array[String] = []
	if from_region.is_empty() or unit_type_id.is_empty():
		return legal
	var from: Region = state.regions.get(from_region)
	if from == null or not from.is_land_region():
		return legal
	if state.movable_stack_count(faction_id, from_region, unit_type_id) <= 0:
		return legal
	for neighbor in state.get_adjacent_regions(from_region):
		var sea_id := str(neighbor)
		var sea: Region = state.regions.get(sea_id)
		if sea == null or not sea.is_sea_region():
			continue
		for transport_id in _friendly_transport_ids(sea_id, faction_id, state):
			if can_load_units(
				transport_id, from_region, [{"unit_type_id": unit_type_id, "count": 1}], faction_id, state
			):
				if sea_id not in legal:
					legal.append(sea_id)
	return legal


func find_transport_for_load(
	from_region: String,
	sea_region: String,
	unit_type_id: String,
	faction_id: String,
	state: GameState
) -> String:
	for transport_id in _friendly_transport_ids(sea_region, faction_id, state):
		if can_load_units(
			transport_id, from_region, [{"unit_type_id": unit_type_id, "count": 1}], faction_id, state
		):
			return transport_id
	return ""


func validate_load(
	transport_instance_id: String,
	from_region: String,
	units: Array,
	faction_id: String,
	state: GameState
) -> VT.ValidationResult:
	var result := VT.ValidationResult.new()
	if transport_instance_id.is_empty() or from_region.is_empty():
		result.errors.append(_err("LOAD_INVALID", "Missing transport or source region"))
	elif not can_load_units(transport_instance_id, from_region, units, faction_id, state):
		result.errors.append(_err("LOAD_INVALID", "Cannot load units onto transport"))
	result.ok = result.errors.is_empty()
	return result


func can_load_units(
	transport_instance_id: String,
	from_region: String,
	units: Array,
	faction_id: String,
	state: GameState
) -> bool:
	if state.current_phase not in ["combat_move", "noncombat_move"]:
		return false
	var td: Dictionary = state.transport_instances.get(transport_instance_id, {})
	if td.is_empty():
		return false
	var sea_region := str(td.get("region_id", ""))
	if sea_region.is_empty() or not state.is_adjacent(from_region, sea_region):
		return false
	var from: Region = state.regions.get(from_region)
	var sea: Region = state.regions.get(sea_region)
	if from == null or sea == null or not from.is_land_region() or not sea.is_sea_region():
		return false
	if not _transport_belongs_to_faction(transport_instance_id, faction_id, state):
		return false
	var transport_type := str(td.get("unit_type_id", "transport"))
	var transport_unit: Unit = state.unit_types.get(transport_type)
	if transport_unit == null:
		return false
	for unit_entry in units:
		if typeof(unit_entry) != TYPE_DICTIONARY:
			return false
		var utid := str(unit_entry.get("unit_type_id", ""))
		var count := int(unit_entry.get("count", 1))
		if count <= 0:
			return false
		if state.movable_stack_count(faction_id, from_region, utid) < count:
			return false
		var cargo_unit: Unit = state.unit_types.get(utid)
		if cargo_unit == null or cargo_unit.category != "land":
			return false
		if not _cargo_allowed(transport_unit, utid, state):
			return false
		if not _has_units_in_region(from_region, faction_id, utid, count, state):
			return false
		var cargo: Array = td.get("cargo", [])
		if not _fits_cargo(transport_unit, cargo, utid, count):
			return false
	return true


func _friendly_transport_ids(sea_region: String, faction_id: String, state: GameState) -> Array[String]:
	var ids: Array[String] = []
	for entry in state.get_faction_units_in_region(sea_region, faction_id):
		if not entry.has("instance_id"):
			continue
		var iid := str(entry.get("instance_id", ""))
		if state.transport_instances.has(iid):
			ids.append(iid)
	return ids


func _transport_belongs_to_faction(transport_instance_id: String, faction_id: String, state: GameState) -> bool:
	var sea_region := str(state.transport_instances.get(transport_instance_id, {}).get("region_id", ""))
	for entry in state.get_faction_units_in_region(sea_region, faction_id):
		if str(entry.get("instance_id", "")) == transport_instance_id:
			return true
	return false


func _has_units_in_region(
	region_id: String,
	faction_id: String,
	unit_type_id: String,
	count: int,
	state: GameState
) -> bool:
	return state.movable_stack_count(faction_id, region_id, unit_type_id) >= count


func _cargo_allowed(transport_unit: Unit, cargo_unit_type_id: String, state: GameState) -> bool:
	var container = transport_unit.container
	if container == null or not container is Dictionary:
		return false
	var cargo: Unit = state.unit_types.get(cargo_unit_type_id)
	if cargo == null:
		return false
	var allowed: Array = container.get("allowed_cargo_categories", [])
	return cargo.category in allowed


func _fits_cargo(transport_unit: Unit, cargo: Array, new_type: String, new_count: int) -> bool:
	var container = transport_unit.container
	if container == null or not container is Dictionary:
		return false
	var capacity := int(container.get("capacity", 0))
	var max_per_type: Dictionary = container.get("max_per_type", {})
	var totals := {}
	var slots := 0
	for line in cargo:
		var utid := str(line.get("unit_type_id", ""))
		var count := int(line.get("count", 0))
		totals[utid] = int(totals.get(utid, 0)) + count
		slots += count
	totals[new_type] = int(totals.get(new_type, 0)) + new_count
	slots += new_count
	if slots > capacity:
		return false
	for utid in totals.keys():
		if max_per_type.has(utid) and int(totals[utid]) > int(max_per_type[utid]):
			return false
	return true


func _err(code: String, message: String) -> VT.MoveError:
	var err := VT.MoveError.new()
	err.code = code
	err.message = message
	return err
