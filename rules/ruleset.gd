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

func get_unit_move_range(unit_type: String) -> int:
	# Prefer explicit move ranges if provided
	if unit_type in unit_move_ranges:
		return unit_move_ranges[unit_type]

	# Fallback to unit_defs["move"]
	var def := get_unit_def(unit_type)
	return def.get("move", 0)

func get_unit_cost(unit_type: String) -> int:
	var def := get_unit_def(unit_type)
	return def.get("cost", 0)

# ---------------------------------------------------------
# PURCHASE + RULE LOGIC
# ---------------------------------------------------------

func can_purchase_unit(unit_type: String, state: GameState) -> bool:
	return get_unit_def(unit_type).size() > 0

func can_unit_enter_region(unit_type: String, region: String, state: GameState, phase: String) -> bool:
	# Placeholder for terrain rules, hostile rules, etc.
	return true

func is_region_hostile_to(region: String, faction_id: String, state: GameState) -> bool:
	# Placeholder for future combat logic
	return false

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
