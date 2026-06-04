extends GutTest

const GAME_SCENE := preload("res://scenes/GameScene.tscn")

func test_region_stack_has_rows_for_selected_region() -> void:
	var scene: GameScene = GAME_SCENE.instantiate()
	add_child_autofree(scene)
	await wait_frames(3)
	var region_id := _first_region_with_units(scene.session.get_state())
	scene._on_region_selected(region_id)
	await wait_frames(1)
	assert_not_null(scene.region_stack_list)
	assert_true(scene.region_stack_list.get_child_count() >= 1)

func _first_region_with_units(snapshot: Dictionary) -> String:
	for region_entry in snapshot.get("regions", []):
		var units: Array = region_entry.get("units", [])
		if units.is_empty():
			continue
		return str(region_entry.get("region_id", ""))
	return ""
