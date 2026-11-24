extends SceneTree

const SEP := "============================================================"


func _init() -> void:
	var game: Node = load("res://scenes/GameScene.tscn").instantiate()
	root.add_child(game)
	await process_frame
	await process_frame
	await _advance_to_mobilize(game)
	await process_frame
	await _run_audit(game)
	quit()


func _run_audit(game: Node) -> void:
	print(SEP, "\nMOBILIZE DRAG AUDIT\n", SEP)
	_print_scene_tree(game)
	var drag_layer := game.find_child("DragLayer", true, false)
	var drag_root := drag_layer.get_node_or_null("DragIconRoot") if drag_layer else null
	var mobilize_panel := game.find_child("MobilizePanel", true, false)
	var right_ui := game.get_node_or_null("02/RightUIRoot")
	var left_ui := game.get_node_or_null("01/LeftUIRoot")
	var visualizer := game.find_child("UnitVisualizer", true, false)
	var map_root := game.find_child("MapRoot", true, false)
	var controller = drag_layer
	if mobilize_panel:
		_print_control_layout("MobilizePanel", mobilize_panel)
		print("MobilizePanel parent chain:")
		var node: Node = mobilize_panel
		while node:
			print("  ", node.name, " (", node.get_class(), ")")
			node = node.get_parent()
	if right_ui:
		print("RightUIRoot size:", right_ui.size, " visible:", right_ui.visible)
	if left_ui:
		print("LeftUIRoot size before:", left_ui.size)
	await _simulate_mobilize_drag(game, controller, drag_root, mobilize_panel, left_ui, visualizer, map_root)


func _print_scene_tree(game: Node) -> void:
	print("\n--- SCENE TREE (mobilization) ---")
	for path in [
		"02/RightUIRoot",
		"MobilizeLayer",
		"MobilizeLayer/MobilizePanelRoot",
		"MobilizeLayer/MobilizePanelRoot/MobilizePanel",
		"DragLayer",
		"DragLayer/DragIconRoot",
		"layer = 0/MapRoot/UnitLayer/UnitVisualizer",
		"layer = 0/MapRoot",
	]:
		var n := game.get_node_or_null(path)
		if n == null:
			n = game.find_child(path.get_file(), true, false)
		var mark := " << MOBILIZE" if n and n.name == "MobilizePanel" else ""
		print(path, "=>", n, " class=", n.get_class() if n else "MISSING", mark)


func _print_control_layout(label: String, control: Control) -> void:
	print("\n--- LAYOUT:", label, "---")
	print("  anchors:", control.anchor_left, control.anchor_top, control.anchor_right, control.anchor_bottom)
	print("  size:", control.size, " min:", control.custom_minimum_size)
	print("  layout_mode:", control.layout_mode)
	print("  mouse_filter:", control.mouse_filter)
	print("  size_flags_h/v:", control.size_flags_horizontal, control.size_flags_vertical)
	var parent := control.get_parent()
	print("  parent:", parent.name if parent else "none", parent.get_class() if parent else "")


func _advance_to_mobilize(game: Node) -> void:
	if not game.has_method("_on_catalog_buy") or game.session == null:
		return
	game._on_catalog_buy("infantry", 1)
	game._on_purchase_confirm_pressed()
	for _i in 3:
		game._on_end_phase_pressed()
		await process_frame
	game._refresh_all()
	await create_timer(0.2).timeout


func _simulate_mobilize_drag(game, controller, drag_root, mobilize_panel, left_ui, visualizer, map_root) -> void:
	if controller == null or visualizer == null:
		print("Missing controller or visualizer")
		return
	controller.configure(visualizer, map_root, visualizer._movement_arrow, visualizer.unit_icon_scene)
	controller.set_context("mobilize", {}, game.session.get_state() if game.session else {})
	var mobilize_layer := game.find_child("MobilizeLayer", true, false) as CanvasLayer
	if mobilize_layer:
		mobilize_layer.visible = true
	elif mobilize_panel:
		mobilize_panel.visible = true
	await process_frame
	var staged: DraggableStagedIcon = null
	for child in game.find_child("StagedUnitsList", true, false).get_children() if game.find_child("StagedUnitsList", true, false) else []:
		for sub in child.get_children():
			if sub is DraggableStagedIcon:
				staged = sub
				break
	if staged == null:
		print("No DraggableStagedIcon in scene (advance to mobilize with pending purchases to test)")
		return
	print("\n--- DRAG ENTRY POINT ---")
	print("uses DragController signals (not built-in drag):", staged.has_signal("drag_started"))
	print("drag_data:", staged.drag_data)
	var start_global := staged.get_drag_start_global()
	print("Calling staged drag_started pipeline via controller...")
	controller._on_staged_icon_drag_started(staged)
	await process_frame
	var preview: UnitIcon = controller._preview_icon
	print("preview created:", preview != null)
	if preview:
		print("\n--- COORDINATE SPACE (mobilization) ---")
		var test_global := start_global + Vector2(120, 80)
		controller._update_drag(test_global)
		print("event.global_position:", test_global)
		print("preview.global_position:", preview.global_position)
		print("preview.scale:", preview.scale)
		var spr := preview.get_node_or_null("IconSprite") as Sprite2D
		if spr and spr.texture:
			print("texture size:", spr.texture.get_size())
			print("effective px:", spr.texture.get_size() * preview.scale)
		if drag_root:
			print("DragIconRoot transform:", drag_root.get_global_transform_with_canvas())
		if map_root:
			print("MapRoot.to_local(event):", map_root.to_local(test_global))
		print("delta preview vs event:", test_global - preview.global_position)
		print("staged icon modulate:", staged.modulate)
		print("arrow visible:", visualizer._movement_arrow.visible if visualizer._movement_arrow else false)
	if left_ui:
		print("LeftUIRoot size WITH preview:", left_ui.size)
	controller._end_drag(start_global + Vector2(200, 100))
	await process_frame
	print("mobilize_drop_requested wired:", controller.mobilize_drop_requested.get_connections().size() > 0)
	if left_ui:
		print("LeftUIRoot size AFTER drag:", left_ui.size)
