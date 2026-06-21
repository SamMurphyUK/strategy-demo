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
