extends Control
class_name DemoScene

var hud: HUD = null

var selected_from: String = ""
var selected_to: String = ""

const DUPLICATE_WINDOW: float = 0.05
var _last_emit_id: String = ""
var _debounce_active: bool = false
var _debounce_timer: Timer = null


func _ready() -> void:
	await get_tree().process_frame

	# Debug: show current scene and children
	print("DemoScene._ready: current_scene:", get_tree().get_current_scene(), "name:", get_tree().get_current_scene().name)
	var child_names := []
	for c in get_children():
		child_names.append("%s (%s)" % [c.name, c.get_class()])
	print("DemoScene children:", child_names)

	hud = get_node_or_null("HUD") as HUD
	if hud == null:
		push_error("DemoScene: HUD not found as direct child. Children: %s" % child_names)
		return

	var cb := Callable(self, "_on_region_selected")
	if not hud.is_connected("region_selected", cb):
		hud.region_selected.connect(cb)

	# Create a one-shot timer used for debouncing duplicate emits
	_debounce_timer = Timer.new()
	_debounce_timer.one_shot = true
	_debounce_timer.wait_time = DUPLICATE_WINDOW
	add_child(_debounce_timer)
	_debounce_timer.timeout.connect(_on_debounce_timeout)

	hud.set_info("Select origin region")
	print("DemoScene ready: hud path:", hud.get_path())


func _on_region_selected(region_id: String) -> void:
	var id: String = region_id.strip_edges()

	print("DemoScene._on_region_selected: raw:'%s' trimmed:'%s' debounce_active:%s last_emit_id:'%s'" % [region_id, id, str(_debounce_active), _last_emit_id])

	# Defensive: ignore empty ids
	if id == "":
		print("DemoScene: Ignoring empty region_id emission.")
		return

	# Debounce: if active and same id as last, ignore
	if _debounce_active and id == _last_emit_id:
		print("DemoScene: Ignoring duplicate rapid emit for id:", id)
		return

	# Accept this emit and start debounce window
	_last_emit_id = id
	_debounce_active = true
	_debounce_timer.start()

	# State machine
	if selected_from == "":
		_select_from(id)
	elif selected_to == "":
		if id == selected_from:
			print("DemoScene: clicked same region as origin; ignoring as destination:", id)
			return
		_select_to(id)
	else:
		print("DemoScene: both selected already; restarting selection with new origin:", id)
		_reset()
		_select_from(id)


func _on_debounce_timeout() -> void:
	_debounce_active = false
	# keep _last_emit_id so identical emits after debounce are still compared


func _select_from(region_id: String) -> void:
	selected_from = region_id
	print("DemoScene: selected_from set ->", selected_from)
	hud.reset_all_highlights()
	hud.highlight_region(region_id, true)
	hud.set_info("From: %s — select destination" % region_id)


func _select_to(region_id: String) -> void:
	selected_to = region_id
	print("DemoScene: selected_to set ->", selected_to)
	hud.highlight_region(region_id, true)
	hud.set_info("From: %s → To: %s" % [selected_from, selected_to])
	_complete_selection()


func _complete_selection() -> void:
	print("DemoScene: COMPLETE SELECTION -> %s -> %s" % [selected_from, selected_to])
	# Show the final text for 1.5 seconds before resetting
	var t: Timer = Timer.new()
	t.one_shot = true
	t.wait_time = 1.5
	add_child(t)
	t.start()
	t.timeout.connect(_reset)


func _reset() -> void:
	selected_from = ""
	selected_to = ""
	hud.reset_all_highlights()
	hud.set_info("Select origin region")
	print("DemoScene: reset selection state")
