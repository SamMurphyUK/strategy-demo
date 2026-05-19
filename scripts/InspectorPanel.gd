extends VBoxContainer
class_name InspectorPanel

# Current selected region (set by MapEditor)
var _selected_region: Node2D = null

# Faction list (mutable)
var _faction_list := ["Neutral", "Allies", "Axis", "Independent"]

# Optional: safer MapEditor reference
@export var map_editor_path: NodePath = NodePath("../..")

# Cached references
@onready var _field_region_id: LineEdit = $RegionIDField
@onready var _field_ipc: SpinBox = $IPCField
@onready var _dropdown_faction: OptionButton = $FactionDropdown
@onready var _button_apply: Button = $ApplyButton

func _ready() -> void:
	print("InspectorPanel script loaded from:", get_script().resource_path)

	# Populate faction dropdown
	_dropdown_faction.clear()
	for f in _faction_list:
		_dropdown_faction.add_item(f)

	# Connect Apply button
	if _button_apply:
		var cb := Callable(self, "_on_apply_pressed")
		if cb.is_valid():
			var conns := _button_apply.get_signal_connection_list("pressed")
			var already_connected := false
			for c in conns:
				if typeof(c) == TYPE_DICTIONARY \
				and c.get("target", null) == self \
				and c.get("method", "") == "_on_apply_pressed":
					already_connected = true
					break
			if not already_connected:
				_button_apply.connect("pressed", cb)
		else:
			push_error("Inspector: _on_apply_pressed not found.")
	else:
		push_error("Inspector: ApplyButton missing.")


func set_region(r: Node2D) -> void:
	_selected_region = r
	_populate_fields_from_region()


func _populate_fields_from_region() -> void:
	if _selected_region == null:
		_field_region_id.text = ""
		_field_ipc.value = 0
		_dropdown_faction.select(0)
		$VictoryCityCheckbox.button_pressed = false
		$FactoryCheckbox.button_pressed = false
		return

	var meta = _selected_region.get_node_or_null("RegionMetadata")
	if meta == null:
		push_error("RegionMetadata missing on region: " + str(_selected_region))
		_field_region_id.text = ""
		_field_ipc.value = 0
		_dropdown_faction.select(0)
		$VictoryCityCheckbox.button_pressed = false
		$FactoryCheckbox.button_pressed = false
		return

	_field_region_id.text = str(meta.region_id)
	_field_ipc.value = int(meta.ipc_value)

	var idx := _faction_list.find(str(meta.faction))
	if idx == -1:
		idx = 0
	_dropdown_faction.select(idx)

	$VictoryCityCheckbox.button_pressed = bool(meta.is_victory_city)
	$FactoryCheckbox.button_pressed = bool(meta.has_factory)


func _on_apply_pressed() -> void:
	if _selected_region == null:
		push_error("Inspector Apply: no region selected")
		return

	var meta = _selected_region.get_node_or_null("RegionMetadata")
	if meta == null:
		push_error("Inspector Apply: RegionMetadata missing")
		return

	# Write UI values back to metadata
	meta.region_id = _field_region_id.text.strip_edges()
	meta.ipc_value = int(_field_ipc.value)

	var faction_idx := _dropdown_faction.get_selected_id()
	if faction_idx >= 0 and faction_idx < _faction_list.size():
		meta.faction = _faction_list[faction_idx]
	else:
		meta.faction = ""

	meta.is_victory_city = $VictoryCityCheckbox.button_pressed
	meta.has_factory = $FactoryCheckbox.button_pressed

	print("Inspector Apply: wrote meta:", meta.to_dict())
