extends Control
class_name DemoScene

# Do not use @onready here; resolve HUD at runtime after the tree stabilizes.
var hud: HUD = null

var selected_from: String = ""
var selected_to: String = ""


func _ready() -> void:
	# Wait one frame so children (including CanvasLayer children) are guaranteed to exist.
	await get_tree().process_frame

	# Try direct child lookup first
	hud = get_node_or_null("HUD") as HUD

	# If not found, print diagnostics and try a safe fallback search among direct children
	if hud == null:
		var child_names: Array[String] = []
		for c in get_children():
			child_names.append(c.name)
		push_error("DemoScene: HUD node not found as direct child. Children: %s" % child_names)
		# Fallback: try to find a node named "HUD" anywhere under this node (non-recursive fallback)
		for c in get_children():
			if c.name == "HUD":
				hud = c as HUD
				break

	if hud == null:
		push_error("DemoScene: HUD still not found after fallback. Aborting HUD hookup.")
		return

	# Connect safely (avoid double-connects)
	if not hud.is_connected("region_selected", Callable(self, "_on_region_selected")):
		hud.region_selected.connect(_on_region_selected)

	hud.set_info("Select origin region")


func _on_region_selected(region_id: String) -> void:
	if selected_from == "":
		_select_from(region_id)
	else:
		_select_to(region_id)


func _select_from(region_id: String) -> void:
	selected_from = region_id
	hud.highlight_region(region_id, true)
	hud.set_info("From: %s — select destination" % region_id)


func _select_to(region_id: String) -> void:
	selected_to = region_id
	hud.highlight_region(region_id, true)
	hud.set_info("From: %s → To: %s" % [selected_from, selected_to])
	_complete_selection()


func _complete_selection() -> void:
	print("SELECTION: %s -> %s" % [selected_from, selected_to])
	_reset()


func _reset() -> void:
	selected_from = ""
	selected_to = ""
	hud.reset_all_highlights()
	hud.set_info("Select origin region")
