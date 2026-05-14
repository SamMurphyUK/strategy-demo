extends RefCounted
class_name TestStateBuilder

var state: GameState
var ruleset: Ruleset

func _init():
	state = GameState.new()
	ruleset = Ruleset.new()

func with_region(name: String, is_land: bool = true, owner := "red") -> TestStateBuilder:
	var r := Region.new()
	r.id = name
	r.name = name
	r.type = "land" if is_land else "sea"
	r.owner_faction_id = str(owner)
	r.ipc_value = 0
	r.is_capital = false
	r.has_factory = false

	state.regions[name] = r
	state.region_units[name] = []
	state.adjacency[name] = []

	return self

func with_adjacent(a: String, b: String) -> TestStateBuilder:
	state.adjacency[a].append(b)
	state.adjacency[b].append(a)
	return self

func with_unit(id: int, unit_type_id: String, region: String, faction := "red") -> TestStateBuilder:
	var entry := {
		"id": id,
		"unit_type_id": unit_type_id,
		"faction_id": str(faction),
		"region": region,
		"count": 1
	}

	if region not in state.region_units:
		state.region_units[region] = []

	state.region_units[region].append(entry)
	return self

func build_state() -> GameState:
	return state

func build_ruleset() -> Ruleset:
	return ruleset
