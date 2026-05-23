extends VBoxContainer
class_name InspectorPanel

# Current selected region
var selected_region: Node2D = null

# Faction list
var faction_list := ["Neutral", "Allies", "Axis", "Independent"]

# Path to MapEditor (configure in inspector or auto-find)
@export var map_editor_path: NodePath = NodePath("")

# Cached MapEditor reference
var map_editor: Node = null

# UI nodes (cached)
@onready var region_id_field: LineEdit = $RegionIDField
@onready var ipc_field: SpinBox = $IPCField
@onready var faction_dropdown: OptionButton = $FactionDropdown
@onready var victory_checkbox: CheckBox = $VictoryCityCheckbox
@onready var factory_checkbox: CheckBox = $FactoryCheckbox
@onready var apply_button: Button = $ApplyButton

# Debug flag
var debug_logging: bool = false


func _ready() -> void:
	print("InspectorPanel ready")

	# Populate faction dropdown
	faction_dropdown.clear()
	for f in faction_list:
		faction_dropdown.add_item(f)

	# Ensure this panel receives input
	self.mouse_filter = Control.MOUSE_FILTER_STOP

	# Safe apply-button auto-connect
	var cb_apply := Callable(self, "_on_apply_button_pressed")
	if not apply_button.is_connected("pressed", cb_apply):
		apply_button.connect("pressed", cb_apply)

	# Defer MapEditor discovery
	call_deferred("_deferred_map_editor_setup")


func _deferred_map_editor_setup() -> void:
	map_editor = _find_map_editor()
	if map_editor == null:
		push_warning("InspectorPanel: MapEditor not found. Some features may not work.")
		return

	# Connect to MapEditor.region_selected
	if map_editor.has_signal("region_selected"):
		var cb := Callable(self, "set_region")
		if not map_editor.is_connected("region_selected", cb):
			map_editor.connect("region_selected", cb)
			if debug_logging:
				print("InspectorPanel: Connected to MapEditor.region_selected")


func _find_map_editor() -> Node:
	# Try explicit path first
	if map_editor_path != NodePath(""):
		var editor = get_node_or_null(map_editor_path)
		if editor:
			return editor

	# Try common parent paths
	var candidates := [
		"../..",
		"../../..",
        "/root/MapEditor"
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
	selected_region = region
	_populate_fields()
	if region != null:
		visible = true
		if debug_logging:
			print("InspectorPanel: set_region ->", region)


func _populate_fields() -> void:
	if selected_region == null:
		_clear_fields()
		return

	var meta := selected_region.get_node_or_null("RegionMetadata")
	if meta == null:
		push_error("RegionMetadata missing on region: " + str(selected_region))
		_clear_fields()
		return

	region_id_field.text = str(meta.region_id)
	ipc_field.value = int(meta.ipc_value)

	var idx := faction_list.find(str(meta.faction))
	if idx == -1:
		idx = 0
	faction_dropdown.select(idx)

	victory_checkbox.button_pressed = bool(meta.is_victory_city)
	factory_checkbox.button_pressed = bool(meta.has_factory)


func _clear_fields() -> void:
	region_id_field.text = ""
	ipc_field.value = 0
	faction_dropdown.select(0)
	victory_checkbox.button_pressed = false
	factory_checkbox.button_pressed = false


func _on_apply_button_pressed() -> void:
	if selected_region == null:
		push_error("Inspector Apply: no region selected")
		return

	var meta := selected_region.get_node_or_null("RegionMetadata")
	if meta == null:
		push_error("Inspector Apply: RegionMetadata missing")
		return

	# Capture old state for undo
	var old_meta: Dictionary = meta.to_dict()

	# Write UI values
	meta.region_id = region_id_field.text.strip_edges()
	meta.ipc_value = int(ipc_field.value)

	var faction_idx = faction_dropdown.selected
	if faction_idx >= 0 and faction_idx < faction_list.size():
		meta.faction = faction_list[faction_idx]
	else:
		meta.faction = ""

	meta.is_victory_city = victory_checkbox.button_pressed
	meta.has_factory = factory_checkbox.button_pressed

	if debug_logging:
		print("Inspector Apply:", meta.to_dict())

	_notify_map_editor(old_meta)


func _notify_map_editor(old_meta: Dictionary) -> void:
	if map_editor == null:
		map_editor = _find_map_editor()

	if map_editor == null:
		push_warning("Inspector: Could not find MapEditor to notify")
		return

	if map_editor.has_method("_save_metadata_undo"):
		map_editor._save_metadata_undo(selected_region, old_meta)

	if map_editor.has_method("on_region_metadata_changed"):
		map_editor.on_region_metadata_changed(selected_region)


func deselect() -> void:
	selected_region = null
	_clear_fields()
	visible = false


# ---------------------------------------------------------
# Spawn Unit Button Handler (working version)
# ---------------------------------------------------------
func _on_spawn_unit_button_pressed() -> void:
	if selected_region == null:
		return

	var meta := selected_region.get_node("RegionMetadata")
	var region_id = meta.region_id

	# Search entire scene tree (owned=true allows cross-scene lookup)
	var gc := get_tree().get_root().find_child("GameController", true, true)
	if gc:
		gc.spawn_unit_at_anchor(region_id, null, "Player")
	else:
		push_warning("GameController not found anywhere in the scene tree.")
