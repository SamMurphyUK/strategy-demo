extends VBoxContainer
class_name InspectorPanel

# Current selected region
var _selected_region: Node2D = null

# Faction list
var _faction_list := ["Neutral", "Allies", "Axis", "Independent"]

# Path to MapEditor (configure in inspector or auto-find)
@export var map_editor_path: NodePath = NodePath("")

# Cached MapEditor reference
var _map_editor: Node = null

# UI nodes
@onready var _field_region_id: LineEdit = $RegionIDField
@onready var _field_ipc: SpinBox = $IPCField
@onready var _dropdown_faction: OptionButton = $FactionDropdown


func _ready() -> void:
	print("InspectorPanel ready")
	
	# Populate faction dropdown
	_dropdown_faction.clear()
	for f in _faction_list:
		_dropdown_faction.add_item(f)
	
	# Find MapEditor
	_map_editor = _find_map_editor()
	if _map_editor == null:
		push_warning("InspectorPanel: MapEditor not found. Some features may not work.")
	else:
		# Connect to MapEditor's region_selected signal if it exists
		if _map_editor.has_signal("region_selected"):
			if not _map_editor.region_selected.is_connected(Callable(self, "set_region")):
				_map_editor.region_selected.connect(Callable(self, "set_region"))
				print("InspectorPanel: Connected to MapEditor.region_selected")


func _find_map_editor() -> Node:
	# Try explicit path first
	if map_editor_path != NodePath(""):
		var editor = get_node_or_null(map_editor_path)
		if editor:
			return editor
	
	# Try common parent paths
	var candidates := [
		"../..",           # ToolLayer/UI/InspectorPanel -> MapEditor
		"../../..",        # Deeper nesting
		"/root/MapEditor"  # Absolute path
	]
	
	for path in candidates:
		var editor = get_node_or_null(path)
		if editor and editor.has_method("on_region_metadata_changed"):
			return editor
	
	# Search up the tree
	var node = get_parent()
	while node != null:
		if node.has_method("on_region_metadata_changed"):
			return node
		node = node.get_parent()
	
	# Last resort: search root children
	var root = get_tree().get_root()
	for child in root.get_children():
		if child.has_method("on_region_metadata_changed"):
			return child
	
	return null


func set_region(region: Node2D) -> void:
	_selected_region = region
	_populate_fields()
	
	if region != null:
		visible = true


func _populate_fields() -> void:
	if _selected_region == null:
		_clear_fields()
		return
	
	var meta = _selected_region.get_node_or_null("RegionMetadata")
	if meta == null:
		push_error("RegionMetadata missing on region: " + str(_selected_region))
		_clear_fields()
		return
	
	_field_region_id.text = str(meta.region_id)
	_field_ipc.value = int(meta.ipc_value)
	
	var idx := _faction_list.find(str(meta.faction))
	if idx == -1:
		idx = 0
	_dropdown_faction.select(idx)
	
	$VictoryCityCheckbox.button_pressed = bool(meta.is_victory_city)
	$FactoryCheckbox.button_pressed = bool(meta.has_factory)


func _clear_fields() -> void:
	_field_region_id.text = ""
	_field_ipc.value = 0
	_dropdown_faction.select(0)
	$VictoryCityCheckbox.button_pressed = false
	$FactoryCheckbox.button_pressed = false


# Connected via scene: ApplyButton.pressed -> _on_apply_button_pressed
func _on_apply_button_pressed() -> void:
	if _selected_region == null:
		push_error("Inspector Apply: no region selected")
		return
	
	var meta = _selected_region.get_node_or_null("RegionMetadata")
	if meta == null:
		push_error("Inspector Apply: RegionMetadata missing")
		return
	
	# Capture old state for undo (if MapEditor supports it)
	var old_meta: Dictionary = meta.to_dict()
	
	# Write UI values to metadata
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
	
	# Notify MapEditor to update visuals and save undo state
	_notify_map_editor(old_meta)


func _notify_map_editor(old_meta: Dictionary) -> void:
	if _map_editor == null:
		_map_editor = _find_map_editor()
	
	if _map_editor == null:
		push_warning("Inspector: Could not find MapEditor to notify")
		return
	
	# Save undo state if MapEditor supports it
	if _map_editor.has_method("_save_metadata_undo"):
		_map_editor._save_metadata_undo(_selected_region, old_meta)
	
	# Update colors and region list
	if _map_editor.has_method("on_region_metadata_changed"):
		_map_editor.on_region_metadata_changed(_selected_region)


# Optional: called when user presses Escape or clicks away
func deselect() -> void:
	_selected_region = null
	_clear_fields()
	visible = false
