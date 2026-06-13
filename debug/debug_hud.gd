extends CanvasLayer
class_name DebugHUD

var game_scene: Variant = null
var drag_controller: Node = null
var map_root: Node = null


func configure(game_scene_ref: Variant, drag_ref: Node, map_ref: Node) -> void:
	game_scene = game_scene_ref
	drag_controller = drag_ref
	map_root = map_ref


func _ready() -> void:
	set_process(false)


func _process(_delta: float) -> void:
	if not visible or game_scene == null:
		return

	var cam: Camera2D = game_scene.find_child("Camera2D", true, false) as Camera2D
	var zoom := cam.zoom if cam else Vector2.ONE
	var cam_pos := cam.position if cam else Vector2.ZERO

	var hover_region := ""
	if drag_controller and map_root and drag_controller.has_method("screen_to_map_global"):
		var mouse := game_scene.get_viewport().get_mouse_position()
		var map_pos := drag_controller.call("screen_to_map_global", mouse)
		if map_root.has_method("_region_id_at_map_position"):
			hover_region = str(map_root.call("_region_id_at_map_position", map_pos))

	var drag_active := drag_controller.call("is_drag_active") if drag_controller else false

	var label: Label = $DebugHUD/HUDLabel
	label.text = (
		"[HUD]\n"
		+ "Zoom: " + str(zoom) + "\n"
		+ "Camera: " + str(cam_pos) + "\n"
		+ "Hover Region: " + hover_region + "\n"
		+ "Drag Active: " + str(drag_active) + "\n"
	)
