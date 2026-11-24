extends RefCounted
class_name Ruleset

# ---------------------------------------------------------
# DATA DEFINITIONS
# ---------------------------------------------------------

# Unit definitions: { unit_type: { "move": int, "cost": int, ... } }
var unit_defs: Dictionary = {}

# Movement ranges: { unit_type: int }
var unit_move_ranges: Dictionary = {}

# Transport capacity: { unit_type: int }
var transport_capacity: Dictionary = {}

# Amphibious rules, special movement rules, etc.
var amphibious_rules: Dictionary = {}

# ---------------------------------------------------------
# UNIT DEFINITION HELPERS
# ---------------------------------------------------------

func get_unit_def(unit_type: String) -> Dictionary:
	return unit_defs.get(unit_type, {})

func get_unit_move_range(unit_type: String, state: GameState = null) -> int:
	if unit_type in unit_move_ranges:
		return int(unit_move_ranges[unit_type])
	var def := get_unit_def(unit_type)
	if def.has("move"):
		return int(def.get("move", 0))
	if state != null:
		var unit: Unit = state.unit_types.get(unit_type)
		if unit != null:
			return unit.movement
	return 0


func sync_from_state(state: GameState) -> void:
	unit_defs.clear()
	unit_move_ranges.clear()
	for utid in state.unit_types.keys():
		var unit: Unit = state.unit_types[utid]
		if unit == null:
			continue
		unit_defs[utid] = {
			"move": unit.movement,
			"cost": unit.cost,
			"category": unit.category,
			"special": unit.special,
		}
		unit_move_ranges[utid] = unit.movement


func unit_can_blitz(unit_type: String, state: GameState) -> bool:
	var unit: Unit = state.unit_types.get(unit_type)
	if unit == null:
		return false
	return bool(unit.special.get("can_blitz", false))


func unit_can_strategic_bomb(unit_type: String, state: GameState) -> bool:
	var unit: Unit = state.unit_types.get(unit_type)
	if unit == null:
		return false
	return bool(unit.special.get("can_strategic_bomb_factory", false))


func is_valid_bomb_target(region_id: String, faction_id: String, state: GameState) -> bool:
	var region: Region = state.regions.get(region_id)
	if region == null or not region.is_land_region() or not region.has_factory:
		return false
	if not is_region_hostile_to(region_id, faction_id, state):
		return false
	return region.owner_faction_id != faction_id

func get_unit_cost(unit_type: String) -> int:
	var def := get_unit_def(unit_type)
	return int(def.get("cost", 0))

# ---------------------------------------------------------
# PURCHASE + RULE LOGIC
# ---------------------------------------------------------

func can_purchase_unit(unit_type: String, state: GameState) -> bool:
	return get_unit_def(unit_type).size() > 0

func can_unit_enter_region(unit_type: String, region_id: String, state: GameState, phase: String) -> bool:
	var region: Region = state.regions.get(region_id)
	if region == null:
		return false
	var unit: Unit = state.unit_types.get(unit_type)
	if unit == null:
		return false

	match unit.category:
		"land":
			if not region.is_land_region():
				return false
		"sea":
			if not region.is_sea_region():
				return false
		"air":
			pass

	if phase == "noncombat_move" and is_region_hostile_to(region_id, state.current_faction_id, state):
		return false

	return true

func is_region_hostile_to(region_id: String, faction_id: String, state: GameState) -> bool:
	return state.is_region_hostile_to(region_id, faction_id)

func get_unit_category(unit_type: String, state: GameState) -> String:
	var unit: Unit = state.unit_types.get(unit_type)
	if unit == null:
		return ""
	return str(unit.category)

func is_sea_unit(unit_type: String, state: GameState) -> bool:
	return get_unit_category(unit_type, state) == "sea"

func can_mobilize_unit_at(
	unit_type: String,
	region_id: String,
	faction_id: String,
	state: GameState
) -> bool:
	var region: Region = state.regions.get(region_id)
	var unit: Unit = state.unit_types.get(unit_type)
	if region == null or unit == null:
		return false
	if unit.category == "sea":
		if not region.is_sea_region():
			return false
		return is_sea_zone_adjacent_to_faction_factory(region_id, faction_id, state)
	if not region.is_land_region():
		return false
	if not region.has_factory:
		return false
	return region.owner_faction_id == faction_id

func is_sea_zone_adjacent_to_faction_factory(
	sea_zone_id: String,
	faction_id: String,
	state: GameState
) -> bool:
	var sea: Region = state.regions.get(sea_zone_id)
	if sea == null or not sea.is_sea_region():
		return false
	for factory_id in state.regions.keys():
		var factory: Region = state.regions[factory_id]
		if factory.has_factory and factory.owner_faction_id == faction_id:
			if state.is_adjacent(sea_zone_id, factory_id):
				return true
	return false

func get_legal_mobilize_regions(
	faction_id: String,
	unit_type: String,
	state: GameState
) -> Array[String]:
	var legal: Array[String] = []
	if unit_type.is_empty() or faction_id.is_empty():
		return legal
	var unit: Unit = state.unit_types.get(unit_type)
	if unit == null:
		return legal
	if unit.category == "sea":
		for region_id in state.regions.keys():
			if can_mobilize_unit_at(unit_type, region_id, faction_id, state):
				legal.append(region_id)
		return legal
	for region_id in state.regions.keys():
		if can_mobilize_unit_at(unit_type, region_id, faction_id, state):
			legal.append(region_id)
	return legal

# ---------------------------------------------------------
# RNG HOOKS (stubs)
# ---------------------------------------------------------

func roll_combat_dice(attacker_units: Array, defender_units: Array, rng):
	return null

func roll_aa_fire(aa_units: Array, incoming_air_units: Array, rng):
	return null

func roll_bombing_damage(bomber, target_factory, rng):
	return null

func roll_convoy_raid(submarines: Array, convoy_zone: String, rng):
	return null
