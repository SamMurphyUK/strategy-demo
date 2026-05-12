class_name CombatEngine
extends RefCounted

var state: GameState
var rng: PCG
var _seq: int = 0

func _init(game_state: GameState, pcg: PCG, seq_start: int = 0) -> void:
	state = game_state
	rng = pcg
	_seq = seq_start

func resolve_all_battles(attacker_faction: String) -> Array:
	var events: Array = []
	var battles := _identify_battles(attacker_faction)
	battles.sort_custom(func(a, b): return a.region_id < b.region_id)
	for battle in battles:
		events.append_array(_resolve_battle(battle))
	return events

func _identify_battles(attacker: String) -> Array:
	var battles: Array = []
	for rid in state.regions:
		var att := state.get_faction_units_in_region(rid, attacker)
		var def := state.get_enemy_units_in_region(rid, attacker)
		if att.size() > 0 and def.size() > 0:
			var region: Region = state.regions[rid]
			battles.append({
				"battle_id": "b_" + rid,
				"region_id": rid,
				"battle_type": "land" if region.is_land() else "naval",
				"attacker_faction_id": attacker,
				"defender_faction_id": def[0].faction_id,
				"is_amphibious": false
			})
	return battles

func _resolve_battle(battle: Dictionary) -> Array:
	var events: Array = []
	var rid: String = battle.region_id
	var att_faction: String = battle.attacker_faction_id
	var def_faction: String = battle.defender_faction_id

	var att_units := _get_combat_units(rid, att_faction)
	var def_units := _get_combat_units(rid, def_faction)

	events.append(GameEvent.create(
		GameEvent.Type.BATTLE_STARTED,
		{
			"battle_id": battle.battle_id,
			"region_id": rid,
			"attacker_faction_id": att_faction,
			"defender_faction_id": def_faction,
			"attacker_units": att_units.duplicate(true),
			"defender_units": def_units.duplicate(true)
		},
		_next_seq()
	))

	var round_num := 0

	while att_units.size() > 0 and def_units.size() > 0:
		round_num += 1

		var att_hits := _roll(battle.battle_id, round_num, "attacker", att_units, "attack", events)
		var def_hits := _roll(battle.battle_id, round_num, "defender", def_units, "defense", events)

		var att_cas := _apply_casualties(att_units, def_hits)
		var def_cas := _apply_casualties(def_units, att_hits)

		if def_cas.size() > 0:
			events.append(GameEvent.create(
				GameEvent.Type.UNITS_DESTROYED,
				{
					"battle_id": battle.battle_id,
					"region_id": rid,
					"faction_id": def_faction,
					"units": def_cas,
					"cause": "combat"
				},
				_next_seq()
			))
			_remove_from_state(rid, def_faction, def_cas)

		if att_cas.size() > 0:
			events.append(GameEvent.create(
				GameEvent.Type.UNITS_DESTROYED,
				{
					"battle_id": battle.battle_id,
					"region_id": rid,
					"faction_id": att_faction,
					"units": att_cas,
					"cause": "combat"
				},
				_next_seq()
			))
			_remove_from_state(rid, att_faction, att_cas)

	var result := (
		"attacker_won" if att_units.size() > 0
		else ("defender_won" if def_units.size() > 0 else "mutual_destruction")
	)

	events.append(GameEvent.create(
		GameEvent.Type.BATTLE_FINISHED,
		{
			"battle_id": battle.battle_id,
			"region_id": rid,
			"result": result
		},
		_next_seq()
	))

	if result == "attacker_won":
		var region: Region = state.regions[rid]
		if region.is_land():
			var prev := region.owner_faction_id
			state.set_region_owner(rid, att_faction)
			events.append(GameEvent.create(
				GameEvent.Type.REGION_CAPTURED,
				{
					"region_id": rid,
					"previous_owner_faction_id": prev,
					"new_owner_faction_id": att_faction,
					"is_capital": region.is_capital
				},
				_next_seq()
			))

	return events

func _get_combat_units(rid: String, faction: String) -> Array:
	var result: Array = []
	for u in state.get_faction_units_in_region(rid, faction):
		var ut: Unit = state.unit_types.get(u.unit_type_id)
		if ut and (ut.attack > 0 or ut.defense > 0):
			result.append(u.duplicate())
	return result

func _roll(bid: String, rnd: int, side: String, units: Array, stat: String, events: Array) -> int:
	var total := 0
	var rolls: Array = []

	units.sort_custom(func(a, b): return a.unit_type_id < b.unit_type_id)

	for u in units:
		var ut: Unit = state.unit_types.get(u.unit_type_id)
		if not ut:
			continue

		var target: int = ut.attack if stat == "attack" else ut.defense
		if target <= 0:
			continue

		var count: int = u.get("count", 1)
		var results: Array = []
		var hits := 0

		for i in range(count):
			var r := rng.roll_d6()
			results.append(r)
			if r <= target:
				hits += 1

		total += hits

		rolls.append({
			"unit_type_id": u.unit_type_id,
			"count": count,
			"target": target,
			"results": results,
			"hits": hits
		})

	events.append(GameEvent.create(
		GameEvent.Type.DICE_ROLLED,
		{
			"battle_id": bid,
			"round_number": rnd,
			"side": side,
			"rolls": rolls,
			"total_hits": total
		},
		_next_seq()
	))

	return total

func _apply_casualties(units: Array, hits: int) -> Array:
	var cas: Array = []

	# FIXED: Unit objects use properties, not .get()
	units.sort_custom(func(a, b):
		var uta: Unit = state.unit_types.get(a.unit_type_id)
		var utb: Unit = state.unit_types.get(b.unit_type_id)

		var ca: int = uta.cost if uta else 999
		var cb: int = utb.cost if utb else 999

		return ca < cb
	)

	var rem := hits
	var i := 0

	while rem > 0 and i < units.size():
		var u: Dictionary = units[i]
		var cnt: int = u.get("count", 1)

		if cnt <= rem:
			cas.append(u.duplicate())
			rem -= cnt
			units.remove_at(i)
		else:
			cas.append({"unit_type_id": u.unit_type_id, "count": rem})
			u.count -= rem
			rem = 0
			i += 1

	return cas

func _remove_from_state(rid: String, faction: String, casualties: Array) -> void:
	for c in casualties:
		var units: Array = state.region_units.get(rid, [])
		for i in range(units.size() - 1, -1, -1):
			var u: Dictionary = units[i]
			if u.faction_id == faction and u.unit_type_id == c.unit_type_id:
				if u.count > c.count:
					u.count -= c.count
					break
				else:
					c.count -= u.count
					units.remove_at(i)
					if c.count <= 0:
						break

func _next_seq() -> int:
	_seq += 1
	return _seq

func set_sequence(val: int) -> void:
	_seq = val
