class_name BattlePhaseController
extends Object

signal battle_phase_completed(result: BattlePhaseResultResource)


func resolve_phase(
	request: BattlePhaseRequestResource,
	amphibious_engine: AmphibiousEngine,
	combat_engine: CombatEngine,
	sync_seq: Callable
) -> BattlePhaseResultResource:
	var result := BattlePhaseResultResource.new()
	var events: Array = []

	events.append_array(sync_seq.call(
		amphibious_engine.resolve_assaults(request.faction_id, combat_engine)
	))
	events.append_array(sync_seq.call(
		combat_engine.resolve_all_battles(request.faction_id)
	))

	result.game_events = events
	result.success = true
	battle_phase_completed.emit(result)
	return result
