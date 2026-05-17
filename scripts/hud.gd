extends CanvasLayer
class_name HUD

signal region_selected(region_id: String)
signal info_faded()

# Resolved at runtime after the tree stabilizes
var region_container: Control = null
var info_label: Label = null

var buttons: Array[RegionButton] = []
var _info_tween = null


func _ready() -> void:
	await get_tree().process_frame

	region_container = get_node_or_null("UI/RegionContainer") as Control
	info_label = get_node_or_null("UI/InfoLabel") as Label

	if info_label == null and region_container:
		info_label = region_container.get_node_or_null("InfoLabel") as Label

	if region_container == null:
		push_error("HUD: RegionContainer not found at UI/RegionContainer")
		return

	if info_label == null:
		push_error("HUD: InfoLabel not found under UI or UI/RegionContainer. Children of UI: %s" % _list_child_names(get_node_or_null("UI")))

	buttons.clear()
	_collect_buttons()
	_connect_buttons()

	print("HUD ready: collected %d RegionButton(s)" % buttons.size())
	for b in buttons:
		print("  -", b.name, "region_id:'%s'" % b.region_id)


func _list_child_names(node: Node) -> Array:
	var names := [] as Array
	if node == null:
		return names
	for c in node.get_children():
		names.append(c.name)
	return names


# Recursive collector to handle nested wrappers
func _collect_buttons() -> void:
	if region_container == null:
		return
	_collect_buttons_recursive(region_container)


func _collect_buttons_recursive(node: Node) -> void:
	for child in node.get_children():
		if child is RegionButton:
			buttons.append(child as RegionButton)
		elif child.get_child_count() > 0:
			_collect_buttons_recursive(child)


func _connect_buttons() -> void:
	var cb := Callable(self, "_on_region_pressed")
	for btn in buttons:
		if not btn.is_connected("region_pressed", cb):
			btn.region_pressed.connect(cb)


func _on_region_pressed(region_id: String) -> void:
	print("HUD: _on_region_pressed -> '%s'" % region_id)
	region_selected.emit(region_id)


# Set info text, keep visible for hold_time seconds, then fade over fade_time seconds.
# Defaults: hold_time = 1.5, fade_time = 1.0
func set_info(text: String, hold_time: float = 1.5, fade_time: float = 1.0) -> void:
	if info_label == null:
		print("HUD (no InfoLabel): '%s'" % text)
		return

	# Cancel any existing tween so fades don't stack
	if _info_tween != null:
		_info_tween.kill()
		_info_tween = null

	# Ensure label is fully visible and update text
	info_label.modulate = Color(1.0, 1.0, 1.0, 1.0)
	info_label.visible = true
	info_label.text = text
	print("HUD.set_info -> writing to:", info_label.get_path(), "value:'%s' hold:%.2f fade:%.2f" % [text, hold_time, fade_time])

	# If both hold_time and fade_time are zero or negative, emit info_faded immediately
	if hold_time <= 0.0 and fade_time <= 0.0:
		emit_signal("info_faded")
		return

	# Create a tween that waits hold_time then either fades alpha over fade_time or simply finishes
	_info_tween = create_tween()
	_info_tween.tween_interval(max(0.0, hold_time))

	if fade_time > 0.0:
		_info_tween.tween_property(info_label, "modulate:a", 0.0, fade_time).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
		_info_tween.connect("finished", Callable(self, "_on_info_fade_finished"))
	else:
		# No fade requested: just wait the hold_time, then call finished handler
		_info_tween.connect("finished", Callable(self, "_on_info_fade_finished"))


func _on_info_fade_finished() -> void:
	# If we faded, the alpha is already 0; if not, we still hide to keep behavior consistent
	if info_label:
		info_label.visible = false
	# Clear tween reference
	_info_tween = null
	# Notify listeners that the info display lifecycle finished
	emit_signal("info_faded")


func highlight_region(region_id: String, value: bool) -> void:
	for btn: RegionButton in buttons:
		if btn.region_id == region_id:
			btn.set_highlight(value)
			return


func reset_all_highlights() -> void:
	for btn: RegionButton in buttons:
		btn.set_highlight(false)
