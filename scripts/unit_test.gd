extends Node2D
class_name UnitTestHelper

signal arrived(unit_name: String)

# renamed to avoid collision with Node.owner
var unit_owner: String = ""
var region_id: String = ""
var anchor_name = ""
@export var speed: float = 120.0

var _target_pos: Vector2
var _moving: bool = false

# renamed setter to avoid overriding Node.set_owner(Node)
func set_unit_owner(o: String) -> void:
	unit_owner = o

func move_to_global_pos(pos: Vector2) -> void:
	_target_pos = pos
	_moving = true

func _physics_process(delta: float) -> void:
	if _moving:
		var dir = _target_pos - global_position
		var dist = dir.length()
		if dist <= 4.0:
			global_position = _target_pos
			_moving = false
			emit_signal("arrived", name)
		else:
			dir = dir.normalized()
			global_position += dir * speed * delta

func _exit_tree() -> void:
	# notify GameController to release anchor
	var gc = get_tree().get_root().find_node("GameController", true, false)
	if gc and gc.has_method("release_anchor"):
		gc.release_anchor(region_id, anchor_name)
