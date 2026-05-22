extends Control
class_name UnitSpawnCommandPanel

signal purchase_units_requested(purchases: Array)
signal move_units_requested(moves: Array)
signal place_units_requested(placements: Array)
signal end_phase_requested()
signal end_turn_requested()

@export var buttons_box: HBoxContainer


func _ready() -> void:
	if buttons_box == null:
		push_warning("UnitSpawnCommandPanel: buttons_box export is not assigned")
		return
	_connect_button(0, _on_purchase_infantry_pressed)
	_connect_button(1, _on_end_phase_pressed)
	_connect_button(2, _on_end_turn_pressed)
	_connect_button(3, _on_quick_move_pressed)
	_connect_button(4, _on_place_units_pressed)


func _connect_button(index: int, callback: Callable) -> void:
	if buttons_box.get_child_count() <= index:
		return
	var button := buttons_box.get_child(index) as Button
	if button != null and not button.pressed.is_connected(callback):
		button.pressed.connect(callback)


func _on_purchase_infantry_pressed() -> void:
	purchase_units_requested.emit([
		{"unit_type_id": "infantry", "count": 2},
	])


func _on_end_phase_pressed() -> void:
	end_phase_requested.emit()


func _on_end_turn_pressed() -> void:
	end_turn_requested.emit()


func _on_quick_move_pressed() -> void:
	move_units_requested.emit([
		{
			"from_region_id": "red_front",
			"to_region_id": "blue_front",
			"units": [{"unit_type_id": "infantry", "count": 3}],
		},
	])


func _on_place_units_pressed() -> void:
	place_units_requested.emit([
		{
			"region_id": "red_capital",
			"units": [{"unit_type_id": "infantry", "count": 2}],
		},
	])
