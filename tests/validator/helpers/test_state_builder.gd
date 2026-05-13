extends RefCounted
class_name TestStateBuilder

var state: GameState
var ruleset: Ruleset

func _init():
	state = GameState.new()
	ruleset = Ruleset.new()

func with_region(name: String, is_land: bool = true, owner := "red") -> TestStateBuilder:
	var r := Region.new()
	r.name = name
	r.is_land = is_land
	r.owner_faction_id = str(owner)   # <-- NORMALISE TO STRING
	r.adjacent.clear()
	state.regions[name] = r
	return self

func with_adjacent(a: String, b: String) -> TestStateBuilder:
	state.regions[a].adjacent.append(b)
	state.regions[b].adjacent.append(a)
	return self

func with_unit(id: int, unit_type: String, region: String, faction := "red") -> TestStateBuilder:
	var u := Unit.new()
	u.id = id
	u.unit_type = unit_type
	u.region = region
	u.faction = str(faction)          # <-- ALSO NORMALISE (prevents future issues)
	state.units[id] = u
	return self

func build_state() -> GameState:
	return state

func build_ruleset() -> Ruleset:
	return ruleset
