extends Ruleset
class_name RulesetClassic

var _unit_defs := {
    "infantry": { "cost": 3, "move": 1, "is_land": true },
    "artillery": { "cost": 4, "move": 1, "is_land": true },
    "tank": { "cost": 6, "move": 2, "is_land": true },
    "fighter": { "cost": 10, "move": 4, "is_air": true },
    "bomber": { "cost": 12, "move": 6, "is_air": true },
    "transport": { "cost": 7, "move": 2, "is_sea": true },
    "submarine": { "cost": 8, "move": 2, "is_sea": true },
    "destroyer": { "cost": 8, "move": 2, "is_sea": true },
    "carrier": { "cost": 14, "move": 2, "is_sea": true },
    "battleship": { "cost": 20, "move": 2, "is_sea": true },
}

func get_unit_def(unit_type: String) -> Dictionary:
    return _unit_defs.get(unit_type, {})

func is_region_hostile_to(region: String, faction_id: String, state: GameState) -> bool:
    return state.is_region_hostile_to(region, faction_id)

func can_unit_enter_region(unit_type: String, region: String, state: GameState, phase: String) -> bool:
    if phase == "non_combat" and is_region_hostile_to(region, state.current_faction_id, state):
        return false
    return true
