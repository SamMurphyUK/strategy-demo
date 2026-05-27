extends RefCounted
class_name GameSessionStub

const UNIT_COSTS := {
	"infantry": 3,
	"artillery": 4,
	"tank": 6,
	"transport": 7,
	"battleship": 20,
}

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
var non_combat_move_phase_controller: NonCombatMovePhaseController
var combat_move_phase_controller: CombatMovePhaseController
var battle_phase_controller: BattlePhaseController
var start_turn_phase_controller: StartTurnPhaseController
var end_turn_phase_controller: EndTurnPhaseController
var collect_income_phase_controller: CollectIncomePhaseController

var debug: bool = false

var _events: Array = []
var _seq: int = 0
var _applied_event_ids: Dictionary = {}
var _demo_seed: int = 12345
var _fixed_timestamp: int = 0


func initialize_demo(seed: int = 12345) -> void:
	_demo_seed = seed
	_fixed_timestamp = 1680000000
	var map_json: Dictionary = GameSessionFactory.load_json("res://newmap.json")
	_init_session(
		GameSceneSessionBuilder.build_map_data(map_json),
		GameSessionFactory.load_json("res://data/scenarios/minimal/units.json"),
		GameSceneSessionBuilder.build_factions_data(),
		GameSceneSessionBuilder.build_setup_data(map_json),
		GameSessionFactory.load_json("res://data/scenarios/minimal/rules.json"),
		{"state": seed, "sequence": 1}
	)


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
	_seq = int(rng_seed.get("sequence", 1)) - 1

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
	non_combat_move_phase_controller = NonCombatMovePhaseController.new()
	combat_move_phase_controller = CombatMovePhaseController.new()
	battle_phase_controller = BattlePhaseController.new()
	start_turn_phase_controller = StartTurnPhaseController.new()
	end_turn_phase_controller = EndTurnPhaseController.new()
	collect_income_phase_controller = CollectIncomePhaseController.new()

	var start_request: StartTurnRequestResource = StartTurnRequestResource.for_game_bootstrap()
	var start_result: StartTurnPhaseResultResource = start_turn_phase_controller.start_turn(
		start_request, turn_engine
	)
	_record_events(_sync_seq(start_result.get_events()), "")


func apply_command(cmd_dict: Dictionary) -> Dictionary:
	var type_str := str(cmd_dict.get("type", "")).to_lower()
	if type_str == "collect_income":
		return _apply_collect_income(cmd_dict)

	var cmd := Command.from_dict(cmd_dict)
	if not validator.validate(cmd):
		return {
			"result_type": "error",
			"error": validator.get_error(),
			"events": [],
		}

	var events: Array = []
	var source_id := str(cmd_dict.get("command_id", ""))

	match cmd.type:
		Command.Type.PURCHASE_UNITS:
			var batch: PurchaseBatchResource = PurchaseBatchResource.from_command(cmd)
			var purchase_result: PurchasePhaseResultResource = (
				purchase_phase_controller.process_purchase(batch, economy, cmd)
			)
			events = _sync_seq(purchase_result.get_events())

		Command.Type.PLACE_UNITS:
			var placement_error := _validate_placement_command(cmd)
			if placement_error.has("result_type"):
				return placement_error
			var place_batch: PlaceUnitsBatchResource = PlaceUnitsBatchResource.from_command(cmd)
			var placement_result: PlaceUnitsPhaseResultResource = (
				place_units_phase_controller.process_placement(place_batch, placement, cmd)
			)
			events = _sync_seq(placement_result.get_events())

		Command.Type.MOVE_UNITS:
			if state.current_phase == "noncombat_move":
				var batch: NonCombatMoveBatchResource = NonCombatMoveBatchResource.from_command(cmd)
				var move_result: NonCombatMovePhaseResultResource = (
					non_combat_move_phase_controller.process_move(batch, movement, cmd)
				)
				events = _sync_seq(move_result.get_events())
			elif state.current_phase == "combat_move":
				var combat_batch: CombatMoveBatchResource = CombatMoveBatchResource.from_command(cmd)
				var combat_move_result: CombatMovePhaseResultResource = (
					combat_move_phase_controller.process_move(combat_batch, movement, cmd)
				)
				events = _sync_seq(combat_move_result.get_events())
			else:
				events = _sync_seq(movement.process_move(cmd))

		Command.Type.END_PHASE:
			var forfeit_events: Array = []
			if state.current_phase == "mobilize":
				forfeit_events = _forfeit_pending_at_mobilize_end(cmd.player_id)
			var request: EndPhaseRequestResource = EndPhaseRequestResource.from_command(
				cmd, state.current_phase
			)
			var end_result: EndPhaseResultResource = end_phase_controller.process_end_phase(
				request,
				state,
				turn_engine,
				amphibious,
				combat,
				battle_phase_controller,
				placement,
				Callable(self, "_sync_seq")
			)
			events = forfeit_events + end_result.get_events()

		Command.Type.END_TURN:
			var end_turn_request: EndTurnRequestResource = EndTurnRequestResource.from_command(
				cmd, state.current_phase
			)
			var end_turn_result: EndTurnPhaseResultResource = (
				end_turn_phase_controller.process_end_turn(
					end_turn_request,
					state,
					economy,
					victory,
					turn_engine,
					Callable(self, "_sync_seq")
				)
			)
			events = end_turn_result.get_events()

		_:
			return {
				"result_type": "error",
				"error": {"code": "UNSUPPORTED", "message": "Command not supported in demo stub"},
				"events": [],
			}

	var canonical := _record_events(events, source_id)
	return {"result_type": "ok", "events": canonical}


func _apply_collect_income(cmd_dict: Dictionary) -> Dictionary:
	var cmd := Command.from_dict(cmd_dict)
	if cmd.player_id != state.current_faction_id:
		return {
			"result_type": "error",
			"error": {"code": "OUT_OF_TURN", "message": "Not your turn"},
			"events": [],
		}
	var request := CollectIncomeRequestResource.from_command(cmd, cmd.player_id)
	var result := collect_income_phase_controller.collect_income(request, economy)
	var events := _sync_seq(result.get_events())
	var canonical := _record_events(events, str(cmd_dict.get("command_id", "")))
	return {"result_type": "ok", "events": canonical}


func get_state() -> Dictionary:
	var snap := state.to_snapshot()
	snap["gameover"] = snap.get("game_over", false)
	return snap


func get_legal_commands(player_id: String) -> Array:
	if player_id != state.current_faction_id:
		return []
	match state.current_phase:
		"purchase":
			return ["purchase_units", "end_phase"]
		"combat_move":
			return ["move_units", "end_phase"]
		"combat":
			return []
		"noncombat_move":
			return ["move_units", "end_phase"]
		"mobilize":
			return ["place_units", "end_phase"]
		"collect_income":
			return ["end_turn", "collect_income"]
	return []


static func validate_event_shape(evt: Dictionary) -> bool:
	var required := [
		"event_id", "sequence", "type", "payload", "source_command_id", "timestamp"
	]
	for key in required:
		if not evt.has(key):
			return false
	return evt["type"] is String and evt["payload"] is Dictionary


func create_event(
	evt_type: String,
	payload: Dictionary,
	source_command_id: String = ""
) -> Dictionary:
	_seq += 1
	var evt := {
		"event_id": "e%05d" % _seq,
		"sequence": _seq,
		"type": _normalize_event_type(evt_type),
		"payload": payload,
		"source_command_id": source_command_id,
		"timestamp": _fixed_timestamp if _fixed_timestamp > 0 else int(Time.get_unix_time_from_system()),
	}
	return evt


func _record_events(events: Array, source_command_id: String) -> Array:
	var canonical: Array = []
	for raw in events:
		var evt_dict: Dictionary
		if raw is GameEvent:
			evt_dict = _game_event_to_canonical(raw as GameEvent, source_command_id)
		elif raw is Dictionary:
			evt_dict = raw.duplicate(true)
			if not evt_dict.has("source_command_id"):
				evt_dict["source_command_id"] = source_command_id
			evt_dict["type"] = _normalize_event_type(str(evt_dict.get("type", "")))
			if not evt_dict.has("timestamp"):
				evt_dict["timestamp"] = _fixed_timestamp
		else:
			continue

		if not validate_event_shape(evt_dict):
			if debug:
				print("GameSessionStub: invalid event shape ", evt_dict)
			continue

		var eid := str(evt_dict.get("event_id", ""))
		if _applied_event_ids.has(eid):
			if debug:
				print("GameSessionStub: skip duplicate event ", eid)
			continue
		_applied_event_ids[eid] = true
		_events.append(evt_dict)
		canonical.append(evt_dict)
	return canonical


func _game_event_to_canonical(evt: GameEvent, source_command_id: String) -> Dictionary:
	return {
		"event_id": str(evt.event_id).replace("_", ""),
		"sequence": evt.sequence,
		"type": _normalize_event_type(GameEvent._type_to_string(evt.type)),
		"payload": evt.payload.duplicate(true),
		"source_command_id": source_command_id,
		"timestamp": _fixed_timestamp if _fixed_timestamp > 0 else int(Time.get_unix_time_from_system()),
	}


func _normalize_event_type(type_name: String) -> String:
	return str(type_name).to_lower().replace("_", "")


func _sync_seq(events: Array) -> Array:
	for e in events:
		if e is GameEvent:
			var ge := e as GameEvent
			if ge.sequence > _seq:
				_seq = ge.sequence
	turn_engine.set_sequence(_seq)
	economy.set_sequence(_seq)
	movement.set_sequence(_seq)
	combat.set_sequence(_seq)
	placement.set_sequence(_seq)
	victory.set_sequence(_seq)
	amphibious.set_sequence(_seq)
	return events


func _validate_placement_command(cmd: Command) -> Dictionary:
	var placements: Array = cmd.payload.get("placements", [])
	var faction_id := cmd.player_id
	var pending: Array = state.pending_purchases.get(faction_id, [])
	var pending_counts := {}
	for line in pending:
		var utid := str(line.get("unit_type_id", ""))
		pending_counts[utid] = pending_counts.get(utid, 0) + int(line.get("count", 0))

	for p in placements:
		var region_id := str(p.get("region_id", ""))
		if not state.is_region_owned_by(region_id, faction_id):
			return _placement_error("Region not owned by faction: %s" % region_id)
		var region: Region = state.regions.get(region_id)
		if region == null or not region.has_factory:
			return _placement_error("Region has no factory: %s" % region_id)

		for u in p.get("units", []):
			var unit_type_id := str(u.get("unit_type_id", ""))
			var count := int(u.get("count", 1))
			if pending_counts.get(unit_type_id, 0) < count:
				return _placement_error(
					"Not enough pending %s (have %d, need %d)"
					% [unit_type_id, pending_counts.get(unit_type_id, 0), count]
				)
			pending_counts[unit_type_id] = pending_counts.get(unit_type_id, 0) - count
	return {}


func _placement_error(message: String) -> Dictionary:
	return {
		"result_type": "error",
		"error": {"code": "PLACEMENT_INVALID", "message": message},
		"events": [],
	}


func _forfeit_pending_at_mobilize_end(faction_id: String) -> Array:
	var pending: Array = state.pending_purchases.get(faction_id, [])
	if pending.is_empty():
		return []

	var ipc_lost := 0
	for p in pending:
		var utid := str(p.get("unit_type_id", ""))
		var count := int(p.get("count", 1))
		var cost := UNIT_COSTS.get(utid, 0)
		if cost == 0:
			var ut: Unit = state.unit_types.get(utid)
			if ut:
				cost = ut.cost
		ipc_lost += cost * count

	state.pending_purchases[faction_id] = []
	_seq += 1
	return [
		GameEvent.create(
			GameEvent.Type.PLACEMENT_FORFEITED,
			{
				"faction_id": faction_id,
				"reason": "unplaced_at_mobilize_end",
				"forfeited_units": pending,
				"ipc_lost": ipc_lost,
			},
			_seq
		)
	]


func _load_units(data: Dictionary) -> void:
	var list: Array = []
	if data.has("units"):
		list = data.units
	elif data.has("unit_types"):
		list = data.unit_types
	else:
		push_error("GameSessionStub: no units in units data")
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
					"region_id": rid,
				}
				state.region_units[rid].append({
					"faction_id": fid,
					"unit_type_id": utid,
					"instance_id": iid,
					"count": 1,
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
					"count": cnt,
				})
