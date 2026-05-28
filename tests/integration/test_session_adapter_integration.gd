extends GutTest

const GAME_SCENE := preload("res://scenes/GameScene.tscn")


func test_adapter_wraps_stub_commands() -> void:
	var demo_stub := GameSessionStub.new()
	demo_stub.initialize_demo(99)
	var adapter := GameSessionAdapter.from_session(demo_stub)
	var res := adapter.apply_command({
		"command_id": "a1",
		"player_id": "allies",
		"type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "infantry", "count": 1}]},
	})
	assert_eq(res["result_type"], "ok")
	assert_eq(res["events"][0]["type"], "unitspurchased")
	assert_true(GameSessionAdapter.validate_event_shape(res["events"][0]))


func test_game_scene_smoke_purchase_mobilize_place() -> void:
	gut.error_tracker.treat_engine_errors_as = GutUtils.TREAT_AS.NOTHING
	var scene: GameScene = GAME_SCENE.instantiate()
	add_child_autofree(scene)
	await wait_frames(3)

	assert_not_null(scene.session, "GameScene should have a session")
	assert_true(scene.session is GameSessionStub)

	var viz = scene.unit_visualizer
	assert_not_null(viz)

	scene._on_spawn_infantry_pressed()
	assert_eq(str(scene.session.state.current_phase), "purchase")

	for i in 3:
		scene._on_end_phase_pressed()
	assert_eq(str(scene.session.state.current_phase), "mobilize")

	var region_id := _first_allies_factory_region(scene.session)
	if scene.map_root and scene.map_root is GameMapRoot:
		(scene.map_root as GameMapRoot).selected_region_id = region_id

	scene._on_spawn_infantry_pressed()
	await wait_frames(2)

	assert_eq(str(scene.session.state.current_phase), "mobilize")
	var pending = scene.session.get_state()["pending_purchases"]["allies"]
	assert_eq(pending, [])
	var snap: Dictionary = scene.session.get_state()
	assert_true(_region_has_infantry(snap, region_id))


func _region_has_infantry(snap: Dictionary, region_id: String) -> bool:
	for region_entry in snap.get("regions", []):
		if str(region_entry.get("region_id", "")) != region_id:
			continue
		for u in region_entry.get("units", []):
			if str(u.get("unit_type_id", "")) == "infantry":
				return int(u.get("count", 0)) > 0
	return false


func _first_allies_factory_region(session: GameSessionStub) -> String:
	for rid in session.state.regions.keys():
		var r: Region = session.state.regions[rid]
		if r.owner_faction_id == "allies" and r.has_factory:
			return rid
	return "region_1"
