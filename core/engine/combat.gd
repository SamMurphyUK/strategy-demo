class_name CombatEngine
extends RefCounted

var state: GameState
var rng: PCG
var _seq: int = 0


func _init(p_state: GameState = null, p_rng: PCG = null) -> void:
	state = p_state
	rng = p_rng


func set_sequence(seq: int) -> void:
	_seq = seq


func _next_seq() -> int:
	_seq += 1
	return _seq


func resolve_all_battles(attacker_faction_id: String) -> Array:
	var events: Array = []
	var battles := _identify_battles(attacker_faction_id)
	
	for battle in battles:
		events.append_array(_resolve_battle(battle))
	
	return events


func _identify_battles(attacker_faction_id: String) -> Array:
	var battles: Array = []
	
	for region_id in state.region_units.keys():
		var region: Region = state.regions.get(region_id)
		if region == null:
			continue
		
		var attacker_units := _get_combat_units(region_id, attacker_faction_id)
		if attacker_units.size() == 0:
			continue
		
		var defender_faction_id := ""
		for unit_entry in state.region_units[region_id]:
			if unit_entry.faction_id != attacker_faction_id:
				var u: Unit = state.unit_types.get(unit_entry.unit_type_id)
				if u and _is_combat_unit(u):
					defender_faction_id = unit_entry.faction_id
					break
		
		if defender_faction_id == "":
			continue
		
		var defender_units := _get_combat_units(region_id, defender_faction_id)
		if defender_units.size() == 0:
			continue
		
		var battle_type := "naval" if region.is_sea_region() else "land"
		
		battles.append({
			"region_id": region_id,
			"attacker_faction_id": attacker_faction_id,
			"defender_faction_id": defender_faction_id,
			"battle_type": battle_type
		})
	
	return battles


func _resolve_battle(battle: Dictionary) -> Array:
	var events: Array = []
	var region_id: String = battle.region_id
	var attacker_id: String = battle.attacker_faction_id
	var defender_id: String = battle.defender_faction_id
	
	events.append(GameEvent.create(
		GameEvent.Type.BATTLE_STARTED,
		{"region_id": region_id, "attacker": attacker_id, "defender": defender_id},
		_next_seq()
	))
	
	var round_num := 0
	var max_rounds := 100
	
	while round_num < max_rounds:
		round_num += 1
		
		var attacker_units := _get_combat_units(region_id, attacker_id)
		var defender_units := _get_combat_units(region_id, defender_id)
		
		if attacker_units.size() == 0 or defender_units.size() == 0:
			break
		
		var attacker_hits := _roll_hits(attacker_units, true)
		var defender_hits := _roll_hits(defender_units, false)
		
		events.append(GameEvent.create(
			GameEvent.Type.DICE_ROLLED,
			{
				"region_id": region_id,
				"round": round_num,
				"attacker_hits": attacker_hits,
				"defender_hits": defender_hits
			},
			_next_seq()
		))
		
		_apply_casualties(region_id, attacker_id, defender_hits)
		_apply_casualties(region_id, defender_id, attacker_hits)
	
	var remaining_attackers := _get_combat_units(region_id, attacker_id)
	var remaining_defenders := _get_combat_units(region_id, defender_id)
	
	var result := "draw"
	if remaining_attackers.size() > 0 and remaining_defenders.size() == 0:
		result = "attacker_won"
		var region: Region = state.regions[region_id]
		if region.is_land_region():
			region.owner_faction_id = attacker_id
	elif remaining_defenders.size() > 0 and remaining_attackers.size() == 0:
		result = "defender_won"
	elif remaining_attackers.size() == 0 and remaining_defenders.size() == 0:
		result = "mutual_destruction"
	
	events.append(GameEvent.create(
		GameEvent.Type.BATTLE_FINISHED,
		{"region_id": region_id, "result": result, "rounds": round_num},
		_next_seq()
	))
	
	return events


func _get_combat_units(region_id: String, faction_id: String) -> Array:
	var combat_units: Array = []
	var region_units: Array = state.region_units.get(region_id, [])
	
	for unit_entry in region_units:
		if unit_entry.faction_id != faction_id:
			continue
		
		var u: Unit = state.unit_types.get(unit_entry.unit_type_id)
		if u == null:
			continue
		
		if _is_combat_unit(u):
			combat_units.append(unit_entry)
	
	return combat_units


func _is_combat_unit(u: Unit) -> bool:
	return u.attack > 0 or u.defense > 0


func _roll_hits(units: Array, is_attacker: bool) -> int:
	var hits := 0
	
	for unit_entry in units:
		var u: Unit = state.unit_types.get(unit_entry.unit_type_id)
		if u == null:
			continue
		
		var count: int = unit_entry.get("count", 1)
		var target_value: int = u.attack if is_attacker else u.defense
		
		for i in range(count):
			# FIXED: PCG uses next_int(), not next()
			var roll: int = (rng.next_int() % 6) + 1
			if roll <= target_value:
				hits += 1
	
	return hits


func _apply_casualties(region_id: String, faction_id: String, hits: int) -> void:
	if hits <= 0:
		return
	
	var region_units: Array = state.region_units.get(region_id, [])
	
	var faction_units: Array = []
	for unit_entry in region_units:
		if unit_entry.faction_id == faction_id:
			var u: Unit = state.unit_types.get(unit_entry.unit_type_id)
			if u and _is_combat_unit(u):
				faction_units.append({"entry": unit_entry, "cost": u.cost})
	
	faction_units.sort_custom(func(a, b): return a.cost < b.cost)
	
	var remaining_hits := hits
	for item in faction_units:
		if remaining_hits <= 0:
			break
		
		var entry = item.entry
		var to_remove: int = mini(entry.count, remaining_hits)
		entry.count -= to_remove
		remaining_hits -= to_remove
	
	var i := region_units.size() - 1
	while i >= 0:
		if region_units[i].faction_id == faction_id and region_units[i].count <= 0:
			region_units.remove_at(i)
		i -= 1
