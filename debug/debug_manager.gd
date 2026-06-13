extends Node
class_name DebugManager

@export var debug_root: Node

var debug_visible: bool = false


func _ready() -> void:
	if debug_root == null:
		debug_root = self
	_apply_visibility()
	set_process_input(true)


func _input(event: InputEvent) -> void:
	if event.is_action_pressed("debug_toggle"):
		debug_visible = not debug_visible
		_apply_visibility()


func _apply_visibility() -> void:
	if debug_root:
		debug_root.visible = debug_visible
	if debug_root == null:
		return
	for child in debug_root.get_children():
		child.set_process(debug_visible)
