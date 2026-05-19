extends VBoxContainer
class_name InspectorPanel

# Current selected region (set by MapEditor)
var _region: Node2D = null

# Faction list (mutable)
var _faction_list = ["Neutral", "Allies", "Axis", "Independent"]

# UI nodes (assumes these children exist under this Control)
@onready var _region_id_field: LineEdit = $RegionIDField
@onready var _ipc_field: SpinBox = $IPCField
@onready var _faction_dropdown: OptionButton = $FactionDropdown
@onready var _victory_checkbox: CheckBox = $VictoryCityCheckbox
@onready var _factory_checkbox: CheckBox = $FactoryCheckbox
@onready var _apply_button: Button = $ApplyButton

func _ready() -> void:
	# populate faction dropdown once
	_faction_dropdown.clear()
	for f in _faction_list:
		_faction_dropdown.add_item(f)

	# ensure Apply button is connected to this inspector's handler
	if _apply_button:
		var cb := Callable(self, "_on_apply_pressed")
		if cb.is_valid():
			# avoid duplicate connects
			var conns := _apply_button.get_signal_connection_list("pressed")
			var already_connected := false
			for c in conns:
				if typeof(c) == TYPE_DICTIONARY and c.get("target", null) == self and c.get("method", "") == "_on_apply_pressed":
					already_connected = true
					break
			if not already_connected:
				_apply_button.connect("pressed", cb)
		else:
			push_error("Inspector: _on_apply_pressed method not found; cannot connect ApplyButton.")
	else:
		push_error("Inspector: ApplyButton not found in scene tree.")


# Called by MapEditor to set the currently edited region
func set_region(r: Node2D) -> void:
	_region = r
	_populate_fields_from_region()


func _populate_fields_from_region() -> void:
	if _region == null:
		_region_id_field.text = ""
		_ipc_field.value = 0
		_faction_dropdown.select(0)
		_victory_checkbox.pressed = false
		_factory_checkbox.pressed = false
		return

	var meta = _region.get_node_or_null("RegionMetadata")
	if meta == null:
		push_error("RegionMetadata missing on region: " + str(_region))
		_region_id_field.text = ""
		_ipc_field.value = 0
		_faction_dropdown.select(0)
		_victory_checkbox.pressed = false
		_factory_checkbox.pressed = false
		return

	_region_id_field.text = str(meta.region_id)
	_ipc_field.value = int(meta.ipc_value)

	var idx := _faction_list.find(str(meta.faction))
	if idx == -1:
		idx = 0
	_faction_dropdown.select(idx)

	_victory_checkbox.pressed = bool(meta.is_victory_city)
	_factory_checkbox.pressed = bool(meta.has_factory)


# Apply button handler: write UI values back into RegionMetadata and notify MapEditor
func _on_apply_pressed() -> void:
	if _region == null:
		push_error("Inspector Apply: no region selected")
		return

	var meta = _region.get_node_or_null("RegionMetadata")
	if meta == null:
		push_error("Inspector Apply: RegionMetadata missing on region")
		return

	# Write UI values back to metadata
	meta.region_id = _region_id_field.text.strip_edges()
	meta.ipc_value = int(_ipc_field.value)

	var faction_idx := _faction_dropdown.get_selected_id()
	if faction_idx >= 0 and faction_idx < _faction_list.size():
		meta.faction = _faction_list[faction_idx]
	else:
		meta.faction = ""

	meta.is_victory_city = _victory_checkbox.pressed
	meta.has_factory = _factory_checkbox.pressed

	# Debug print to confirm the write
	print("Inspector Apply: wrote meta:", meta.to_dict())

	# Notify MapEditor to update the on-map label (safe lookup)
	var editor := get_tree().get_root().get_node_or_null("MapEditor")
	if editor != null:
		if editor.has_method("update_ipc_label_for_region"):
			editor.call("update_ipc_label_for_region", _region)
		elif editor.has_method("update_ipc_label2d"):
			editor.call("update_ipc_label2d", _region)
		elif editor.has_method("update_ipc_ui_label"):
			editor.call("update_ipc_ui_label", _region)
		else:
			print("Inspector Apply: MapEditor found but no known update method.")
	else:
		print("Inspector Apply: MapEditor node not found at scene root.")
