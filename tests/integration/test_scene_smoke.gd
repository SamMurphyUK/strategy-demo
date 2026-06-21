extends GutTest

const GAME_SCENE := preload("res://scenes/GameScene.tscn")


func before_each() -> void:
	gut.error_tracker.treat_engine_errors_as = GutUtils.TREAT_AS.NOTHING
	gut.error_tracker.treat_push_error_as = GutUtils.TREAT_AS.NOTHING


func test_headless_scene_smoke_flow() -> void:
	var scene: GameScene = GAME_SCENE.instantiate()
	add_child_autofree(scene)
	await wait_frames(3)

	assert_not_null(scene.session)
	assert_true(scene.session is GameSessionStub)

	var stub: GameSessionStub = scene.session
	var region_id := _first_allies_factory_region(stub)

	scene._on_spawn_infantry_pressed()
	assert_eq(int(scene.ui_pending_purchases.get("infantry", 0)), 1)

	for i in 4:
		scene._on_end_phase_pressed()
	assert_eq(str(stub.state.current_phase), "mobilize")

	if scene.map_root and scene.map_root is GameMapRoot:
		(scene.map_root as GameMapRoot).selected_region_id = region_id

	scene._on_spawn_infantry_pressed()
	await wait_frames(2)

	var snap := stub.get_state()
	assert_eq(snap["pending_purchases"]["allies"], [])
	assert_true(_region_has_infantry(snap, region_id))


func _region_has_infantry(snap: Dictionary, region_id: String) -> bool:
	for region_entry in snap.get("regions", []):
		if str(region_entry.get("region_id", "")) != region_id:
			continue
		for u in region_entry.get("units", []):
			if str(u.get("unit_type_id", "")) == "infantry":
				return int(u.get("count", 0)) > 0
	return false


func _first_allies_factory_region(stub: GameSessionStub) -> String:
	for rid in stub.state.regions.keys():
		var r: Region = stub.state.regions[rid]
		if r.owner_faction_id == "allies" and r.has_factory:
			return rid
	return "region_1"
