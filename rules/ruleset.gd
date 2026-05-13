extends RefCounted
class_name Ruleset

func get_unit_def(unit_type: String) -> Dictionary:
    return {}

func get_unit_move_range(unit_type: String) -> int:
    var def := get_unit_def(unit_type)
    return def.get("move", 0)

func get_unit_cost(unit_type: String) -> int:
    var def := get_unit_def(unit_type)
    return def.get("cost", 0)

func can_purchase_unit(unit_type: String, state: GameState) -> bool:
    return get_unit_def(unit_type).size() > 0

func can_unit_enter_region(unit_type: String, region: String, state: GameState, phase: String) -> bool:
    return true

func is_region_hostile_to(region: String, faction_id: String, state: GameState) -> bool:
    return false

# RNG hooks (stubs)
func roll_combat_dice(attacker_units: Array, defender_units: Array, rng): return null
func roll_aa_fire(aa_units: Array, incoming_air_units: Array, rng): return null
func roll_bombing_damage(bomber, target_factory, rng): return null
func roll_convoy_raid(submarines: Array, convoy_zone: String, rng): return null
