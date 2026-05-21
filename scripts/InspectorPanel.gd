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
	if faction_dropdown:
		faction_dropdown.clear()
		for f in faction_list:
			faction_dropdown.add_item(f)

	# Ensure this panel receives input even if parent UI is pass-through
	if self is Control:
		self.mouse_filter = Control.MOUSE_FILTER_STOP

	# Safe apply-button auto-connect
	if apply_button:
		var cb_apply := Callable(self, "_on_apply_button_pressed")
		if not apply_button.is_connected("pressed", cb_apply):
			apply_button.connect("pressed", cb_apply)

	# Defer MapEditor discovery and signal hookup
	call_deferred("_deferred_map_editor_setup")


func _deferred_map_editor_setup() -> void:
	map_editor = _find_map_editor()
	if map_editor == null:
		push_warning("InspectorPanel: MapEditor not found. Some features may not work.")
		return

	# Connect to MapEditor's region_selected signal safely using Callable
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

	if region_id_field:
		region_id_field.text = str(meta.region_id)
	if ipc_field:
		ipc_field.value = int(meta.ipc_value)

	var idx := faction_list.find(str(meta.faction))
	if idx == -1:
		idx = 0
	if faction_dropdown:
		faction_dropdown.select(idx)

	# Use button_pressed (older inspector's property) to avoid analyzer quirk
	if victory_checkbox:
		# write via property that your project recognizes
		victory_checkbox.button_pressed = bool(meta.is_victory_city)

	if factory_checkbox:
		factory_checkbox.button_pressed = bool(meta.has_factory)


func _clear_fields() -> void:
	if region_id_field:
		region_id_field.text = ""
	if ipc_field:
		ipc_field.value = 0
	if faction_dropdown:
		faction_dropdown.select(0)
	if victory_checkbox:
		victory_checkbox.button_pressed = false
	if factory_checkbox:
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

	# Write UI values to metadata
	if region_id_field:
		meta.region_id = region_id_field.text.strip_edges()
	if ipc_field:
		meta.ipc_value = int(ipc_field.value)

	var faction_idx: int = -1
	if faction_dropdown:
		if faction_dropdown.has_method("get_selected_index"):
			faction_idx = faction_dropdown.get_selected_index()
		elif faction_dropdown.has_method("get_selected_id"):
			faction_idx = faction_dropdown.get_selected_id()

	if faction_idx >= 0 and faction_idx < faction_list.size():
		meta.faction = faction_list[faction_idx]
	else:
		meta.faction = ""

	# Read checkbox state using the property your project recognizes
	if victory_checkbox:
		meta.is_victory_city = victory_checkbox.button_pressed
	if factory_checkbox:
		meta.has_factory = factory_checkbox.button_pressed

	if debug_logging:
		print("Inspector Apply: wrote meta:", meta.to_dict())

	# Notify MapEditor
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
