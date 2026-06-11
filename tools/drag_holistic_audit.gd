extends SceneTree

const SEP := "============================================================"


func _init() -> void:
	var game: Node = load("res://scenes/GameScene.tscn").instantiate()
	root.add_child(game)
	await process_frame
	await process_frame
	await create_timer(0.6).timeout
	await _run_audit(game)
	quit()


func _run_audit(game: Node) -> void:
	print(SEP, "\nDRAG HOLISTIC AUDIT\n", SEP)
	_print_scene_tree(game)
	var drag_layer := game.find_child("DragLayer", true, false)
	var container := drag_layer.get_node_or_null("DragIconRoot") if drag_layer else null
	if container == null and drag_layer:
		container = drag_layer.get_node_or_null("DragIconContainer")
	var visualizer := game.find_child("UnitVisualizer", true, false)
	var map_root := game.find_child("MapRoot", true, false)
	var left_ui := game.get_node_or_null("01/LeftUIRoot")
	print("\nViewport stretch:", ProjectSettings.get_setting("display/window/stretch/mode"))
	print("Viewport size:", get_root().get_visible_rect().size)
	if left_ui:
		print("LeftUIRoot size before drag:", left_ui.size)
	await _simulate_drag(game, visualizer, drag_layer, container, map_root, left_ui)


func _print_scene_tree(game: Node) -> void:
	print("\n--- SCENE TREE (drag-related) ---")
	for path in [
		"DragLayer",
		"DragLayer/DragIconRoot",
		"layer = 0/MapRoot/UnitLayer/UnitVisualizer",
		"01/LeftUIRoot",
	]:
		var n := game.get_node_or_null(path)
		if n == null:
			n = game.find_child(path.get_file(), true, false)
		print(path, "=>", n, " class=", n.get_class() if n else "MISSING")


func _simulate_drag(game, visualizer, drag_layer, container, map_root, left_ui) -> void:
	if visualizer == null:
		return
	var icon: UnitIcon = null
	for child in visualizer.get_children():
		if child is UnitIcon:
			icon = child
			break
	if icon == null:
		print("No UnitIcon found")
		return
	var controller = drag_layer
	if controller == null or not controller.has_method("_begin_map_drag"):
		print("No DragController")
		return
	controller.set_context("combat_move", {}, {})
	controller.configure(visualizer, map_root, visualizer._movement_arrow, visualizer.unit_icon_scene)
	var test_global := icon.global_position + Vector2(40, 25)
	print("\n--- CONTAINER LAYOUT ---")
	if container:
		print("DragIconRoot class:", container.get_class())
		print("  position:", container.position, " global_pos:", container.global_position)
		if container is Control:
			var c := container as Control
			print("  size:", c.size, " custom_minimum_size:", c.custom_minimum_size)
		print("  parent:", container.get_parent().name, container.get_parent().get_class())
	if left_ui:
		print("LeftUIRoot size after context:", left_ui.size)
	controller._begin_map_drag(icon, test_global)
	await process_frame
	var preview: UnitIcon = controller._preview_icon
	if preview == null:
		print("No preview spawned")
		return
	print("\n--- COORDINATE SPACE ---")
	print("test event.global_position:", test_global)
	print("preview.position:", preview.position)
	print("preview.global_position:", preview.global_position)
	print("preview.get_global_transform_with_canvas():", preview.get_global_transform_with_canvas())
	if container:
		print("container.get_global_transform_with_canvas():", container.get_global_transform_with_canvas())
	print("visualizer.to_local(test):", visualizer.to_local(test_global))
	if map_root:
		print("map_root.to_local(test):", map_root.to_local(test_global))
	print("viewport.get_mouse_position():", get_root().get_mouse_position())
	print("delta preview vs event:", test_global - preview.global_position)
	print("\n--- TRANSFORM & SCALE ---")
	print("preview.scale:", preview.scale)
	var spr := preview.get_node_or_null("IconSprite") as Sprite2D
	if spr and spr.texture:
		print("texture path/size:", spr.texture.resource_path, spr.texture.get_size())
		print("IconSprite.scale:", spr.scale)
		print("effective px:", spr.texture.get_size() * spr.scale * preview.scale)
	var da := preview.get_node_or_null("DragArea")
	if da:
		var col := da.get_node_or_null("CollisionShape2D")
		if col and col.shape is RectangleShape2D:
			print("CollisionShape2D.size:", col.shape.size)
	print("preview parent:", preview.get_parent().name, preview.get_parent().get_class())
	if left_ui:
		print("LeftUIRoot size WITH preview:", left_ui.size)
		if container is Control:
			print("container.size WITH preview:", (container as Control).size)
		else:
			print("container has no Control size (Node2D root)")
	print("\n--- LIFECYCLE ---")
	print("original icon visible:", icon.visible)
	print("preview is Node2D:", preview is Node2D)
	print("preview parent is Control:", preview.get_parent() is Control)
	_audit_texture_import(spr.texture.resource_path if spr and spr.texture else "")
	controller._cancel_drag()
	await process_frame
	if left_ui:
		print("LeftUIRoot size AFTER cancel:", left_ui.size)


func _audit_texture_import(path: String) -> void:
	print("\n--- TEXTURE IMPORT ---")
	if path.is_empty():
		return
	print("path:", path)
	var import_path := path + ".import"
	if FileAccess.file_exists(import_path):
		print(FileAccess.get_file_as_string(import_path).substr(0, 400))
