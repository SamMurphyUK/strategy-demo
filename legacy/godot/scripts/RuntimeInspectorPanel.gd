extends VBoxContainer
class_name RuntimeInspectorPanel

# The region currently selected in the *game* map
var selected_region: Node2D = null

# UI nodes (optional — remove if not needed)
@onready var region_id_field: LineEdit = $RegionIDField
@onready var spawn_button: Button = $SpawnUnitButton


func _ready() -> void:
	print("RuntimeInspectorPanel ready")
	self.mouse_filter = Control.MOUSE_FILTER_STOP

	# Safe connect for spawn button
	if spawn_button:
		var cb := Callable(self, "_on_spawn_unit_button_pressed")
		if not spawn_button.is_connected("pressed", cb):
			spawn_button.connect("pressed", cb)


# Called by PrototypeRoot when a region is selected
func set_region(region: Node2D) -> void:
	selected_region = region

	if region == null:
		visible = false
		return

	visible = true

	# Optional: show region ID in UI
	var meta := region.get_node_or_null("RegionMetadata")
	if meta and region_id_field:
		region_id_field.text = str(meta.region_id)


# ---------------------------------------------------------
# Spawn Unit Button Handler (runtime version)
# ---------------------------------------------------------
func _on_spawn_unit_button_pressed() -> void:
	if selected_region == null:
		push_warning("No region selected.")
		return

	var meta := selected_region.get_node_or_null("RegionMetadata")
	if meta == null:
		push_warning("Selected region has no RegionMetadata.")
		return

	var region_id = meta.region_id

	# Search entire scene tree for GameController
	var gc := get_tree().get_root().find_child("GameController", true, true)
	if gc:
		gc.spawn_unit_at_anchor(region_id, null, "Player")
	else:
		push_warning("GameController not found in scene tree.")
