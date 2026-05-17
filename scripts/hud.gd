extends CanvasLayer
class_name HUD

signal region_selected(region_id: String)

# Resolve these at runtime after the tree stabilizes
var region_container: Control = null
var info_label: Label = null

var buttons: Array[RegionButton]


func _ready() -> void:
	# CanvasLayer can initialize before children; wait one frame to be safe.
	await get_tree().process_frame

	# Resolve nodes now that the tree is stable
	region_container = get_node_or_null("UI/RegionContainer") as Control
	info_label = get_node_or_null("UI/InfoLabel") as Label

	if region_container == null:
		push_error("HUD: RegionContainer not found at UI/RegionContainer")
		return

	if info_label == null:
		push_error("HUD: InfoLabel not found at UI/RegionContainer/InfoLabel")
		# continue — info_label is optional for functionality, but we won't try to write to it if null

	buttons = [] as Array[RegionButton]
	_collect_buttons()
	_connect_buttons()


func _collect_buttons() -> void:
	if region_container == null:
		return

	var count: int = region_container.get_child_count()
	for i: int in range(count):
		var child: Node = region_container.get_child(i)
		if child is RegionButton:
			buttons.append(child as RegionButton)


func _connect_buttons() -> void:
	for btn: RegionButton in buttons:
		if not btn.is_connected("region_pressed", Callable(self, "_on_region_pressed")):
			btn.region_pressed.connect(_on_region_pressed)


func _on_region_pressed(region_id: String) -> void:
	region_selected.emit(region_id)


func set_info(text: String) -> void:
	if info_label:
		info_label.text = text
	else:
		# optional: print to console so you still get feedback when InfoLabel is missing
		print("HUD (no InfoLabel): %s" % text)


func highlight_region(region_id: String, value: bool) -> void:
	for btn: RegionButton in buttons:
		if btn.region_id == region_id:
			btn.set_highlight(value)
			return


func reset_all_highlights() -> void:
	for btn: RegionButton in buttons:
		btn.set_highlight(false)
