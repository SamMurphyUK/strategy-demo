extends CanvasLayer
class_name HUD

signal region_selected(region_id: String)
signal units_dropped(from_region: String, to_region: String, unittypeid: String, count: int)
signal info_faded()

@export var unit_stack_scene: PackedScene = preload("res://scenes/ui/UnitStack.tscn")
@export var region_container_node_path: NodePath = NodePath("UI/RegionContainer")
@export var info_label_node_path: NodePath = NodePath("InfoLabel")

@onready var region_container: Control = get_node_or_null(region_container_node_path)
@onready var info_label: Label = get_node_or_null(info_label_node_path)

var buttons: Array = []
var _button_map: Dictionary = {}
var _unit_pool: Array = []

var _info_tween = null

func _ready() -> void:
	await get_tree().process_frame
	buttons.clear()
	_button_map.clear()
	_unit_pool.clear()

# ---------------------------------------------------------
# SAFE DICTIONARY
# ---------------------------------------------------------
func _safe_dict(v: Variant) -> Dictionary:
	return v if typeof(v) == TYPE_DICTIONARY else {}

# ---------------------------------------------------------
# MAIN ENTRY: LOAD REGIONS FROM STATE
# ---------------------------------------------------------
func load_regions_from_state(state: Variant, positions: Dictionary = {}, reuse_pool: bool = true) -> void:
	buttons.clear()
	_button_map.clear()

	var regions_map: Dictionary = {}

	# Accept either a Dictionary or an object-like GameState
	if state == null:
		regions_map = {}
	elif typeof(state) == TYPE_DICTIONARY:
		if state.has("regions"):
			regions_map = _safe_dict(state.get("regions", {}))
		else:
			regions_map = _safe_dict(state)
	elif typeof(state) == TYPE_OBJECT:
		if state.has("regions"):
			regions_map = _safe_dict(state.regions)
		elif state.has_method("get"):
			regions_map = _safe_dict(state.get("regions", {}))
		else:
			regions_map = {}
	else:
		regions_map = {}

	if region_container == null:
		region_container = get_node_or_null(region_container_node_path)
		if region_container == null:
			push_error("HUD: RegionContainer not found at %s" % str(region_container_node_path))
			return

	for region_id in regions_map.keys():
		if not region_container.has_node(region_id):
			push_error("HUD: RegionContainer missing region node '%s'" % region_id)
			continue

		var region_node: Node = region_container.get_node(region_id)
		var btn_node: Node = null
		if region_node.has_node("RegionButton"):
			btn_node = region_node.get_node("RegionButton")
		else:
			for c in region_node.get_children():
				if c and c.has_method("add_unit_stack"):
					btn_node = c
					break

		if btn_node == null:
			push_error("HUD: Region node '%s' missing RegionButton child" % region_id)
			continue

		# configure button: set region_id if possible
		if btn_node.has_method("set"):
			btn_node.set("region_id", region_id)
		else:
			if btn_node.has_meta("region_id"):
				btn_node.set_meta("region_id", region_id)

		# connect signals safely using Callable for is_connected
		var pressed_callable := Callable(self, "_on_region_button_pressed")
		var dropped_callable := Callable(self, "_on_units_dropped")

		if not btn_node.is_connected("region_pressed", pressed_callable):
			btn_node.connect("region_pressed", pressed_callable)
		if not btn_node.is_connected("units_dropped", dropped_callable):
			btn_node.connect("units_dropped", dropped_callable)

		buttons.append(btn_node)
		_button_map[region_id] = btn_node

		var region_data: Dictionary = _safe_dict(regions_map.get(region_id, {}))
		_update_button_from_region(btn_node, region_data)
		_refresh_region_units(region_id, state, reuse_pool)

# ---------------------------------------------------------
# UNIT STACK MANAGEMENT
# ---------------------------------------------------------
func _acquire_unitstack():
	if _unit_pool.size() > 0:
		var u = _unit_pool.pop_back()
		u.visible = true
		return u
	if unit_stack_scene:
		return unit_stack_scene.instantiate()
	return null

func _release_unitstack(u, reuse_pool: bool) -> void:
	if u == null:
		return
	if reuse_pool:
		u.visible = false
		_unit_pool.append(u)
	else:
		u.queue_free()

func _refresh_region_units(region_id: String, state: Variant, reuse_pool: bool = true) -> void:
	if not _button_map.has(region_id):
		return

	var btn = _button_map[region_id]
	if btn.has_method("clear_unit_stacks"):
		btn.clear_unit_stacks()

	var regionunits_map: Dictionary = {}

	if state != null:
		if typeof(state) == TYPE_DICTIONARY:
			regionunits_map = _safe_dict(state.get("regionunits", {}))
		elif typeof(state) == TYPE_OBJECT:
			if state.has("regionunits"):
				regionunits_map = _safe_dict(state.regionunits)
			elif state.has_method("get"):
				regionunits_map = _safe_dict(state.get("regionunits", {}))

	var stacks: Array = []
	if regionunits_map.has(region_id):
		var raw = regionunits_map.get(region_id)
		if typeof(raw) == TYPE_ARRAY:
			stacks = raw

	var visible_count: int = 0
	for s in stacks:
		if typeof(s) != TYPE_DICTIONARY:
			continue
		var dict_s: Dictionary = s
		var faction_id: String = str(dict_s.get("factionid", ""))
		var unittypeid: String = str(dict_s.get("unittypeid", ""))
		var cnt: int = int(dict_s.get("count", 1))

		var us = _acquire_unitstack()
		if us == null:
			continue
		if us.has_method("setup"):
			us.setup(region_id, faction_id, unittypeid, cnt)
		if btn.has_method("add_unit_stack"):
			btn.add_unit_stack(us)
		visible_count += 1

	# overflow badge handling (best-effort)
	if btn.has_node("OverflowBadge"):
		var badge = btn.get_node("OverflowBadge")
		if badge and badge is Label:
			if visible_count > 8:
				badge.text = "+%d" % (visible_count - 8)
				badge.visible = true
			else:
				badge.visible = false

# ---------------------------------------------------------
# REGION VISUALS
# ---------------------------------------------------------
func _update_button_from_region(btn, region_data: Dictionary) -> void:
	var has_factory: bool = bool(region_data.get("has_factory", false))
	var is_victory: bool = bool(region_data.get("is_victory_city", false))

	if btn.has_method("show_factory"):
		btn.show_factory(has_factory)
	if btn.has_method("show_victory"):
		btn.show_victory(is_victory)

func update_region_visual(region_id: String, region_state: Dictionary = {}, reuse_pool: bool = true) -> void:
	if not _button_map.has(region_id):
		return
	var btn = _button_map[region_id]
	_update_button_from_region(btn, region_state)
	if region_state.has("units") and typeof(region_state["units"]) == TYPE_ARRAY:
		var tmp_state: Dictionary = { "regionunits": { region_id: region_state["units"] } }
		_refresh_region_units(region_id, tmp_state, reuse_pool)

# ---------------------------------------------------------
# SIGNAL HANDLERS
# ---------------------------------------------------------
func _on_region_button_pressed(region_id: String) -> void:
	emit_signal("region_selected", region_id)

func _on_units_dropped(from_region: String, to_region: String, unittypeid: String, count: int) -> void:
	emit_signal("units_dropped", from_region, to_region, unittypeid, count)

# ---------------------------------------------------------
# HIGHLIGHTING
# ---------------------------------------------------------
func highlight_region(region_id: String, value: bool) -> void:
	if _button_map.has(region_id):
		var btn = _button_map[region_id]
		if btn and btn.has_method("set_highlight"):
			btn.set_highlight(value)

func highlight_adjacent(region_id: String, adjacency: Dictionary = {}, value: bool = true) -> void:
	if not adjacency or not adjacency.has(region_id):
		return
	for neighbor_id in adjacency[region_id]:
		highlight_region(neighbor_id, value)

func reset_all_highlights() -> void:
	for btn in buttons:
		if btn and btn.has_method("set_highlight"):
			btn.set_highlight(false)

# ---------------------------------------------------------
# INFO LABEL
# ---------------------------------------------------------
func set_info(text: String, hold_time: float = 1.5, fade_time: float = 1.0) -> void:
	if info_label == null:
		print("HUD (no InfoLabel): '%s'" % text)
		return

	if _info_tween != null:
		_info_tween.kill()
		_info_tween = null

	info_label.modulate = Color(1, 1, 1, 1)
	info_label.visible = true
	info_label.text = text

	if hold_time <= 0 and fade_time <= 0:
		emit_signal("info_faded")
		return

	_info_tween = create_tween()
	_info_tween.tween_interval(max(0.0, hold_time))

	if fade_time > 0:
		_info_tween.tween_property(info_label, "modulate:a", 0.0, fade_time)
		_info_tween.connect("finished", Callable(self, "_on_info_fade_finished"))

func _on_info_fade_finished() -> void:
	if info_label:
		info_label.visible = false
	emit_signal("info_faded")
	_info_tween = null
