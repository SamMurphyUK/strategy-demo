extends Resource
class_name ContentLoader

var unit_db: UnitDatabase = UnitDatabase.new()


func _load_json(path: String) -> Dictionary:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		push_error("ContentLoader: Failed to open %s" % path)
		return {}

	var text: String = file.get_as_text()
	file.close()

	var data: Variant = JSON.parse_string(text)
	if typeof(data) != TYPE_DICTIONARY:
		push_error("ContentLoader: Invalid JSON in %s" % path)
		return {}

	return data as Dictionary


func load_scenario(path: String) -> GameState:
	var scenario: Dictionary = _load_json(path)
	if scenario.is_empty():
		return null

	var state := GameState.new()

	# -------------------------
	# Load units
	# -------------------------
	unit_db.load_from_json(scenario["units_file"])
	state.unit_types = unit_db.units.duplicate(true)

	# -------------------------
	# Load factions
	# -------------------------
	var factions_data: Dictionary = _load_json(scenario["factions_file"])
	for f: Dictionary in factions_data["factions"]:
		var faction: Faction = Faction.from_dict(f)
		var fid: String = f["id"]
		state.factions[fid] = faction
		state.ipc[fid] = int(f["starting_ipc"])

	# -------------------------
	# Load regions + adjacency
	# -------------------------
	var regions_data: Dictionary = _load_json(scenario["regions_file"])
	for r: Dictionary in regions_data["regions"]:
		var region: Region = Region.from_dict(r)
		var rid: String = r["id"]
		state.regions[rid] = region
		state.adjacency[rid] = r["adjacent"]

	# -------------------------
	# Init region_units
	# -------------------------
	state.region_units = {}
	for region_id: String in state.regions.keys():
		state.region_units[region_id] = []

	# -------------------------
	# Starting units
	# -------------------------
	var su_data: Dictionary = _load_json(scenario["starting_units_file"])
	for entry: Dictionary in su_data["starting_units"]:
		var region_id: String = entry["region_id"]
		if not state.region_units.has(region_id):
			continue

		state.region_units[region_id].append({
			"faction_id": entry["faction_id"],
			"unit_type_id": entry["unit_type_id"],
			"count": int(entry["count"])
		})

	# -------------------------
	# Rules / meta
	# -------------------------
	state.rules = scenario["rules"]
	state.current_faction_id = _get_first_faction_in_turn_order(state)
	state.current_phase = scenario.get("starting_phase", "purchase")
	state.turn_number = 1
	state.game_round = scenario.get("starting_round", 1)
	state.game_over = false
	state.winner_faction_id = ""

	return state


func _get_first_faction_in_turn_order(state: GameState) -> String:
	var best_id: String = ""
	var best_order: int = 9999

	for f_id: String in state.factions.keys():
		var f: Faction = state.factions[f_id]

		# Faction is a class, not a Dictionary — so no .has()
		if f.turn_order == null:
			continue

		var order: int = f.turn_order
		if order < best_order:
			best_order = order
			best_id = f_id

	return best_id
