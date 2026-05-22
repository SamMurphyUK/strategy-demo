extends RefCounted
class_name GameSession

var state: GameState
var rng: PCG
var validator: CommandValidator
var turn_engine: TurnEngine
var economy: EconomyEngine
var movement: MovementEngine
var combat: CombatEngine
var placement: PlacementEngine
var victory: VictoryEngine
var amphibious: AmphibiousEngine
var purchase_phase_controller: PurchasePhaseController
var end_phase_controller: EndPhaseController
var place_units_phase_controller: PlaceUnitsPhaseController

var _events: Array = []
var _seq: int = 0


# -------------------------------------------------------------------
# FACTORY
# -------------------------------------------------------------------
static func create(
	map_data: Dictionary,
	units_data: Dictionary,
	factions_data: Dictionary,
	setup_data: Dictionary,
	rules_data: Dictionary,
	rng_seed: Dictionary
) -> GameSession:
	var s := GameSession.new()
	s._init_session(map_data, units_data, factions_data, setup_data, rules_data, rng_seed)
	return s


# -------------------------------------------------------------------
# INITIALIZATION
# -------------------------------------------------------------------
func _init_session(
	map_data: Dictionary,
	units_data: Dictionary,
	factions_data: Dictionary,
	setup_data: Dictionary,
	rules_data: Dictionary,
	rng_seed: Dictionary
) -> void:

	state = GameState.new()
	rng = PCG.from_seed(rng_seed)

	_load_units(units_data)
	_load_factions(factions_data)
	_load_map(map_data)
	_load_setup(setup_data)

	state.rules = rules_data

	validator = CommandValidator.new(state)
	turn_engine = TurnEngine.new(state)
	economy = EconomyEngine.new(state)
	movement = MovementEngine.new(state)
	combat = CombatEngine.new(state, rng)
	placement = PlacementEngine.new(state)
	victory = VictoryEngine.new(state)
	amphibious = AmphibiousEngine.new(state)
	purchase_phase_controller = PurchasePhaseController.new()
	end_phase_controller = EndPhaseController.new()
	place_units_phase_controller = PlaceUnitsPhaseController.new()

	_append(_sync_seq(turn_engine.start_game()))


# -------------------------------------------------------------------
# COMMAND APPLICATION
# -------------------------------------------------------------------
func apply_command(cmd_dict: Dictionary) -> Dictionary:
	var cmd := Command.from_dict(cmd_dict)

	if not validator.validate(cmd):
		return {
			"result_type": "error",
			"error": validator.get_error(),
			"events": [],
			"new_state": state.to_snapshot()
		}

	var events: Array = []

	match cmd.type:
		Command.Type.PURCHASE_UNITS:
			var batch: PurchaseBatchResource = PurchaseBatchResource.from_command(cmd)
			var purchase_result: PurchasePhaseResultResource = (
				purchase_phase_controller.process_purchase(batch, economy, cmd)
			)
			events = _sync_seq(purchase_result.get_events())

		Command.Type.MOVE_UNITS:
			events = _sync_seq(movement.process_move(cmd))

		Command.Type.LOAD_TRANSPORT:
			events = _sync_seq(movement.process_load(cmd))

		Command.Type.UNLOAD_TRANSPORT:
			events = _sync_seq(movement.process_unload(cmd))

		Command.Type.DESIGNATE_AMPHIBIOUS:
			events = _sync_seq(amphibious.designate_assault(cmd))

		Command.Type.PLACE_UNITS:
			var batch: PlaceUnitsBatchResource = PlaceUnitsBatchResource.from_command(cmd)
			var placement_result: PlaceUnitsPhaseResultResource = (
				place_units_phase_controller.process_placement(batch, placement, cmd)
			)
			events = _sync_seq(placement_result.get_events())

		Command.Type.END_PHASE:
			var request: EndPhaseRequestResource = EndPhaseRequestResource.from_command(
				cmd, state.current_phase
			)
			var end_result: EndPhaseResultResource = end_phase_controller.process_end_phase(
				request,
				state,
				turn_engine,
				amphibious,
				combat,
				placement,
				Callable(self, "_sync_seq")
			)
			events = end_result.get_events()

		Command.Type.END_TURN:
			events = _handle_end_turn()

	_append(events)

	return {
		"result_type": "ok",
		"events": events.map(func(e): return e.to_dict()),
		"new_state": state.to_snapshot()
	}


# -------------------------------------------------------------------
# TURN / PHASE HANDLING
# -------------------------------------------------------------------
func _handle_end_turn() -> Array:
	var events: Array = []

	if state.current_phase == "collect_income":
		events.append_array(_sync_seq(economy.collect_income(state.current_faction_id)))

	events.append_array(_sync_seq(victory.check_victory()))

	if not state.game_over:
		events.append_array(_sync_seq(turn_engine.end_turn()))

	return events


# -------------------------------------------------------------------
# QUERY HELPERS
# -------------------------------------------------------------------
func get_state() -> Dictionary:
	return state.to_snapshot()


func get_events_since(seq: int) -> Array:
	var result: Array = []
	for e in _events:
		if e.sequence > seq:
			result.append(e.to_dict())
	return result


func get_legal_commands(player: String) -> Array:
	if player != state.current_faction_id:
		return []

	match state.current_phase:
		"purchase":
			return ["purchase_units", "end_phase"]

		"combat_move":
			return ["move_units", "load_transport", "designate_amphibious", "end_phase"]

		"combat":
			return []

		"noncombat_move":
			return ["move_units", "load_transport", "unload_transport", "end_phase"]

		"mobilize":
			return ["place_units", "end_phase"]

		"collect_income":
			return ["end_turn"]

	return []


# -------------------------------------------------------------------
# INTERNAL HELPERS
# -------------------------------------------------------------------
func _sync_seq(events: Array) -> Array:
	for e in events:
		if e.sequence > _seq:
			_seq = e.sequence

	turn_engine.set_sequence(_seq)
	economy.set_sequence(_seq)
	movement.set_sequence(_seq)
	combat.set_sequence(_seq)
	placement.set_sequence(_seq)
	victory.set_sequence(_seq)
	amphibious.set_sequence(_seq)

	return events


func _append(events: Array) -> void:
	_events.append_array(events)


# -------------------------------------------------------------------
# DATA LOADERS
# -------------------------------------------------------------------
func _load_units(data: Dictionary) -> void:
	var list := []

	if data.has("units"):
		list = data.units
	elif data.has("unit_types"):
		list = data.unit_types
	else:
		push_error("No units or unit_types found in units.json")
		return

	for ud in list:
		var u := Unit.from_dict(ud)
		state.unit_types[u.id] = u


func _load_factions(data: Dictionary) -> void:
	for fd in data.factions:
		var f := Faction.from_dict(fd)
		state.factions[f.id] = f
		state.ipc[f.id] = f.starting_ipc
		state.pending_purchases[f.id] = []


func _load_map(data: Dictionary) -> void:
	for rd in data.regions:
		var r := Region.from_dict(rd)
		state.regions[r.id] = r
		state.region_units[r.id] = []

	for edge in data.adjacency:
		var f: String = edge.from
		var t: String = edge.to

		if f not in state.adjacency:
			state.adjacency[f] = []
		if t not in state.adjacency:
			state.adjacency[t] = []

		if t not in state.adjacency[f]:
			state.adjacency[f].append(t)
		if f not in state.adjacency[t]:
			state.adjacency[t].append(f)


func _load_setup(data: Dictionary) -> void:
	state.turn_order = data.turn_order

	for entry in data.starting_units:
		var rid: String = entry.region_id
		var fid: String = entry.faction_id
		var utid: String = entry.unit_type_id
		var cnt: int = entry.count
		var ut: Unit = state.unit_types.get(utid)

		var is_container := (
			ut != null
			and ut.container != null
			and ut.container is Dictionary
			and not ut.container.is_empty()
		)

		if is_container:
			for i in range(cnt):
				var iid := state.generate_instance_id(utid, fid)
				state.transport_instances[iid] = {
					"instance_id": iid,
					"unit_type_id": utid,
					"cargo": [],
					"region_id": rid
				}
				state.region_units[rid].append({
					"faction_id": fid,
					"unit_type_id": utid,
					"instance_id": iid,
					"count": 1
				})
		else:
			var found := false
			for u in state.region_units[rid]:
				if u.faction_id == fid and u.unit_type_id == utid and not u.has("instance_id"):
					u.count += cnt
					found = true
					break

			if not found:
				state.region_units[rid].append({
					"faction_id": fid,
					"unit_type_id": utid,
					"count": cnt
				})
