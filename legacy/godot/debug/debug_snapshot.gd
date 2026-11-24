extends Node
class_name DebugSnapshot


func print_scene_tree() -> void:
	get_tree().get_root().print_tree_pretty()


func print_core_transforms(game_scene: Node) -> void:
	if game_scene == null:
		return
	var cam := game_scene.get_node_or_null("layer = 0/Camera2D")
	var map := game_scene.get_node_or_null("layer = 0/MapRoot")
	if cam:
		print("[SNAPSHOT] Camera2D transform:", cam.get_global_transform())
	if map:
		print("[SNAPSHOT] MapRoot transform:", map.get_global_transform())
