extends Node2D
class_name UnitBoardView

@export var bridge: GameSessionBridge
@export var unit_scene: PackedScene
@export var region_positions: Dictionary = {
	"red_capital": Vector2(200, 300),
	"red_front": Vector2(350, 300),
	"blue_front": Vector2(500, 300),
	"blue_capital": Vector2(650, 300),
	"sea_west": Vector2(275, 450),
	"sea_east": Vector2(575, 450),
}

const STACK_OFFSET := Vector2(18, 0)


func _ready() -> void:
	_connect_bridge()


func _connect_bridge() -> void:
	if bridge == null:
		push_warning("UnitBoardView: bridge export is not assigned")
		return
	if not bridge.state_snapshot_updated.is_connected(_on_state_snapshot_updated):
		bridge.state_snapshot_updated.connect(_on_state_snapshot_updated)


func _on_state_snapshot_updated(snapshot: Dictionary) -> void:
	_clear_units()
	if unit_scene == null:
		return

	var regions: Array = snapshot.get("regions", [])
	for region_entry in regions:
		if typeof(region_entry) != TYPE_DICTIONARY:
			continue
		var region_id: String = str(region_entry.get("region_id", ""))
		var base_pos: Vector2 = region_positions.get(region_id, Vector2.ZERO)
		var units: Array = region_entry.get("units", [])
		var stack_index := 0
		for unit_entry in units:
			if typeof(unit_entry) != TYPE_DICTIONARY:
				continue
			_spawn_stack(
				base_pos + STACK_OFFSET * stack_index,
				region_id,
				str(unit_entry.get("faction_id", "")),
				str(unit_entry.get("unit_type_id", "")),
				int(unit_entry.get("count", 1)),
			)
			stack_index += 1


func _spawn_stack(
	pos: Vector2,
	region_id: String,
	faction_id: String,
	unit_type_id: String,
	count: int
) -> void:
	var inst: Node2D = unit_scene.instantiate() as Node2D
	if inst == null:
		return
	inst.name = "Unit_%s_%s" % [region_id, unit_type_id]
	inst.position = pos
	if inst.has_method("set_unit_owner"):
		inst.set_unit_owner(faction_id)
	else:
		inst.set("unit_owner", faction_id)
	inst.set("region_id", region_id)
	add_child(inst)

	var label := Label.new()
	label.text = "%s x%d" % [unit_type_id, count]
	label.position = Vector2(-20, -30)
	label.add_theme_font_size_override("font_size", 10)
	inst.add_child(label)


func _clear_units() -> void:
	for child in get_children().duplicate():
		remove_child(child)
		child.free()
