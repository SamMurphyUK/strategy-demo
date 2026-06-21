extends GutTest

const GAME_SCENE := preload("res://scenes/GameScene.tscn")


func test_inspector_visible_after_region_select() -> void:
	var scene: GameScene = GAME_SCENE.instantiate()
	add_child_autofree(scene)
	await wait_frames(3)
	assert_not_null(scene.region_inspector_panel, "RegionInspectorPanel should bind")
	var region_id := _first_region_id(scene.session.get_state())
	if scene.map_root and scene.map_root.has_method("select_region"):
		scene.map_root.call("select_region", region_id)
	else:
		scene._on_region_selected(region_id)
	await wait_frames(2)
	var panel: RegionInspectorPanel = scene.region_inspector_panel
	assert_true(panel.visible, "Inspector should be visible when region selected")
	assert_gt(panel.size.y, 0.0, "Inspector should have non-zero height")
	var bar := panel.get_node_or_null("CollapsedPanel/CollapsedMargin/CollapsedBar")
	assert_not_null(bar)
	var collapsed := panel.get_node_or_null("CollapsedPanel")
	assert_not_null(collapsed)
	assert_true(collapsed.visible, "Collapsed panel should be visible")
	assert_gt(collapsed.size.y, 0.0, "Collapsed panel should have height")


func _first_region_id(snapshot: Dictionary) -> String:
	for region_entry in snapshot.get("regions", []):
		return str(region_entry.get("region_id", ""))
	return ""
