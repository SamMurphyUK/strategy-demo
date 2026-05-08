extends GutTest

var state: GameState
var economy: EconomyEngine


func before_each() -> void:
	state = GameState.new()
	
	state.unit_types["infantry"] = Unit.from_dict({
		"id": "infantry", "name": "Infantry", "category": "land",
		"attack": 1, "defense": 2, "movement": 1, "cost": 3
	})
	state.unit_types["tank"] = Unit.from_dict({
		"id": "tank", "name": "Tank", "category": "land",
		"attack": 3, "defense": 3, "movement": 2, "cost": 6
	})
	
	state.factions["red"] = Faction.from_dict({
		"id": "red", "name": "Red", "color": "#FF0000", "starting_ipc": 24
	})
	
	state.ipc["red"] = 24
	state.pending_purchases["red"] = []
	
	state.regions["capital"] = Region.from_dict({
		"id": "capital", "name": "Capital", "type": "land",
		"ipc_value": 8, "owner_faction_id": "red",
		"is_capital": true, "has_factory": true
	})
	state.regions["territory"] = Region.from_dict({
		"id": "territory", "name": "Territory", "type": "land",
		"ipc_value": 4, "owner_faction_id": "red",
		"is_capital": false, "has_factory": false
	})
	
	economy = EconomyEngine.new(state)


func test_purchase_deducts_ipc() -> void:
	var cmd := Command.from_dict({
		"command_id": "c1", "player_id": "red", "type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "infantry", "count": 3}]}
	})
	
	economy.process_purchase(cmd)
	
	assert_eq(state.get_faction_ipc("red"), 15, "Should deduct 9 IPC (3 infantry × 3)")


func test_purchase_multiple_unit_types() -> void:
	var cmd := Command.from_dict({
		"command_id": "c1", "player_id": "red", "type": "purchase_units",
		"payload": {"purchases": [
			{"unit_type_id": "infantry", "count": 2},
			{"unit_type_id": "tank", "count": 1}
		]}
	})
	
	economy.process_purchase(cmd)
	
	# 2 infantry (6) + 1 tank (6) = 12 IPC
	assert_eq(state.get_faction_ipc("red"), 12, "Should deduct 12 IPC")


func test_purchase_records_pending() -> void:
	var cmd := Command.from_dict({
		"command_id": "c1", "player_id": "red", "type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "infantry", "count": 4}]}
	})
	
	economy.process_purchase(cmd)
	
	var pending: Array = state.pending_purchases["red"]
	assert_eq(pending.size(), 1, "Should have 1 pending purchase")
	assert_eq(pending[0].unit_type_id, "infantry")
	assert_eq(pending[0].count, 4)


func test_purchase_emits_event() -> void:
	var cmd := Command.from_dict({
		"command_id": "c1", "player_id": "red", "type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "infantry", "count": 2}]}
	})
	
	var events := economy.process_purchase(cmd)
	
	assert_eq(events.size(), 1)
	assert_eq(events[0].type, GameEvent.Type.UNITS_PURCHASED)
	assert_eq(events[0].payload.faction_id, "red")
	assert_eq(events[0].payload.ipc_spent, 6)
	assert_eq(events[0].payload.ipc_remaining, 18)


func test_collect_income_from_owned_land() -> void:
	var events := economy.collect_income("red")
	
	# capital (8) + territory (4) = 12
	assert_eq(state.get_faction_ipc("red"), 36, "Should add 12 IPC")


func test_collect_income_ignores_sea_zones() -> void:
	state.regions["sea_1"] = Region.from_dict({
		"id": "sea_1", "name": "Sea", "type": "sea",
		"ipc_value": 0, "owner_faction_id": "",
		"is_capital": false, "has_factory": false
	})
	
	var events := economy.collect_income("red")
	
	assert_eq(state.get_faction_ipc("red"), 36, "Sea zones don't affect income")


func test_collect_income_ignores_enemy_territory() -> void:
	state.regions["enemy"] = Region.from_dict({
		"id": "enemy", "name": "Enemy", "type": "land",
		"ipc_value": 6, "owner_faction_id": "blue",
		"is_capital": false, "has_factory": false
	})
	
	var events := economy.collect_income("red")
	
	assert_eq(state.get_faction_ipc("red"), 36, "Enemy territory doesn't count")


func test_collect_income_emits_event() -> void:
	var events := economy.collect_income("red")
	
	assert_eq(events.size(), 1)
	assert_eq(events[0].type, GameEvent.Type.INCOME_COLLECTED)
	assert_eq(events[0].payload.faction_id, "red")
	assert_eq(events[0].payload.amount, 12)
	assert_eq(events[0].payload.new_total, 36)
