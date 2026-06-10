extends Control
class_name GameScene

var map_root: Node = null
var unit_visualizer: Node = null

var state_label: Label = null
var faction_selector: OptionButton = null
var ipc_allies_label: Label = null
var ipc_axis_label: Label = null
var pending_list: VBoxContainer = null
var pending_total_label: Label = null
var unit_catalog: VBoxContainer = null
var purchase_confirm_button: Button = null
var cancel_purchase_button: Button = null
var spawn_infantry_button: Button = null
var move_unit_button: Button = null
var end_phase_button: Button = null
var end_turn_button: Button = null
var event_log: RichTextLabel = null

var region_info_vbox: VBoxContainer = null
var region_name_label: Label = null
var region_owner_label: Label = null
var region_unitcount_label: Label = null
var purchase_panel: Control = null
var mobilize_panel: Control = null
var staged_units_list: VBoxContainer = null
var region_stack: Control = null
var region_stack_list: VBoxContainer = null
var battle_overlay: CanvasLayer = null
var right_ui_root: Control = null

var session = null
var _command_counter: int = 0
var ui_pending_purchases: Dictionary = {}
var debug: bool = true

const CATALOG_UNITS := ["infantry", "artillery", "tank", "transport", "battleship"]
const DraggableStagedIconScript := preload("res://scripts/draggable_staged_icon.gd")

func _ready() -> void:
	print("LeftUIRoot size =", $"01/LeftUIRoot".size)
	print("LeftUIRoot pos =", $"01/LeftUIRoot".global_position)
	print("LeftUIRoot visible =", $"01/LeftUIRoot".visible)
	print("LeftVBox size =", $"01/LeftUIRoot/LeftVBox".size)



	_autobind_nodes()
	_setup_faction_selector()
	_connect_ui()
	session = GameSessionFactory.create(GameSessionFactory.Mode.STUB)
	if session == null:
		push_error("GameScene: Failed to create session")

	UnitTextureCache.debug_print_all_unit_textures()

	_refresh_all()
	if map_root and map_root.has_signal("region_selected"):
		map_root.connect("region_selected", Callable(self, "_on_region_selected"))
	if unit_visualizer and unit_visualizer.get("unit_icon_scene") == null:
		var preferred := "res://scenes/UnitIcon.tscn"
		var fallback := "res://scenes/ui/UnitIcon.tscn"
		if ResourceLoader.exists(preferred):
			unit_visualizer.unit_icon_scene = load(preferred)
		elif ResourceLoader.exists(fallback):
			unit_visualizer.unit_icon_scene = load(fallback)
	if unit_visualizer and unit_visualizer.has_signal("movement_drop_requested"):
		unit_visualizer.movement_drop_requested.connect(_on_unit_movement_drop)

func _autobind_nodes() -> void:
	map_root = get_node_or_null("layer = 0/MapRoot")
	if map_root == null:
		map_root = find_child("MapRoot", true, false)
	unit_visualizer = find_child("UnitVisualizer", true, false)

	var left_ui: Control = get_node_or_null("01/LeftUIRoot")
	var right_ui: Control = get_node_or_null("02/RightUIRoot")
	if left_ui == null or right_ui == null:
		push_warning("LeftUIRoot or RightUIRoot not found in scene.")
		return

	state_label = left_ui.find_child("StateLabel", true, false)

	faction_selector = left_ui.find_child("FactionSelector", true, false)
	if faction_selector == null:
		faction_selector = left_ui.find_child("FactionSelect", true, false)

	ipc_allies_label = right_ui.find_child("AlliesIPCLabel", true, false)
	ipc_axis_label = right_ui.find_child("AxisIPCLabel", true, false)
	pending_list = right_ui.find_child("PendingPurchasesList", true, false)
	pending_total_label = right_ui.find_child("PendingTotalLabel", true, false)
	unit_catalog = right_ui.find_child("UnitCatalogList", true, false)
	purchase_confirm_button = right_ui.find_child("PurchaseConfirmButton", true, false)
	cancel_purchase_button = right_ui.find_child("CancelPurchaseButton", true, false)

	spawn_infantry_button = left_ui.find_child("SpawnInfantryButton", true, false)
	if spawn_infantry_button == null:
		spawn_infantry_button = left_ui.find_child("SpawnInfantry", true, false)

	move_unit_button = left_ui.find_child("MoveUnitButton", true, false)
	if move_unit_button == null:
		move_unit_button = left_ui.find_child("MoveUnit", true, false)

	end_phase_button = left_ui.find_child("EndPhaseButton", true, false)
	if end_phase_button == null:
		end_phase_button = left_ui.find_child("EndPhase", true, false)

	end_turn_button = left_ui.find_child("EndTurnButton", true, false)
	if end_turn_button == null:
		end_turn_button = left_ui.find_child("EndTurn", true, false)

	event_log = left_ui.find_child("EventLog", true, false)
	region_info_vbox = left_ui.find_child("RegionInfo", true, false)
	region_name_label = left_ui.find_child("RegionNameLabel", true, false)
	region_owner_label = left_ui.find_child("OwnerLabel", true, false)
	region_unitcount_label = left_ui.find_child("UnitCountLabel", true, false)
	purchase_panel = right_ui.find_child("PurchasePanel", true, false)
	mobilize_panel = left_ui.find_child("MobilizePanel", true, false)
	staged_units_list = left_ui.find_child("StagedUnitsList", true, false)
	region_stack = left_ui.find_child("RegionStack", true, false)
	region_stack_list = left_ui.find_child("RegionStackList", true, false)
	right_ui_root = right_ui
	battle_overlay = find_child("BattleOverlay", true, false)

func _setup_faction_selector() -> void:
	if faction_selector == null:
		return
	faction_selector.clear()
	faction_selector.add_item("Allies")
	faction_selector.add_item("Axis")
	faction_selector.select(0)

func _connect_ui() -> void:
	if purchase_confirm_button:
		purchase_confirm_button.pressed.connect(_on_purchase_confirm_pressed)
	if cancel_purchase_button:
		cancel_purchase_button.pressed.connect(_on_cancel_purchase_pressed)
	if spawn_infantry_button:
		spawn_infantry_button.pressed.connect(_on_spawn_infantry_pressed)
	if move_unit_button:
		move_unit_button.pressed.connect(_on_move_unit_pressed)
	if end_phase_button:
		end_phase_button.pressed.connect(_on_end_phase_pressed)
	if end_turn_button:
		end_turn_button.pressed.connect(_on_end_turn_pressed)
	_build_unit_catalog()

func _build_unit_catalog() -> void:
	if unit_catalog == null:
		return
	for child in unit_catalog.get_children():
		child.queue_free()
	for unit_type_id in CATALOG_UNITS:
		var row := HBoxContainer.new()
		var label := Label.new()
		label.text = "%s (cost %d)" % [unit_type_id.capitalize(), _unit_cost(unit_type_id)]
		row.add_child(label)
		var buy := Button.new()
		buy.text = "+"
		buy.pressed.connect(func() -> void: _on_catalog_buy(unit_type_id, 1))
		row.add_child(buy)
		unit_catalog.add_child(row)

func _on_catalog_buy(unit_type_id: String, count: int = 1) -> void:
	if _current_phase() != "purchase":
		_log_system("Purchases only allowed in purchase phase.")
		return
	ui_pending_purchases[unit_type_id] = int(ui_pending_purchases.get(unit_type_id, 0)) + count
	_refresh_purchase_panels(session.get_state() if session else {})

func _on_purchase_confirm_pressed() -> void:
	if session == null:
		return
	var purchases: Array = []
	for unit_type_id in ui_pending_purchases.keys():
		var c := int(ui_pending_purchases[unit_type_id])
		if c > 0:
			purchases.append({"unit_type_id": unit_type_id, "count": c})
	if purchases.is_empty():
		_log_system("No pending purchases to confirm.")
		return
	var result: Dictionary = session.apply_command({
		"command_id": _next_command_id(),
		"player_id": _selected_faction_id(),
		"type": "purchase_units",
		"payload": {"purchases": purchases},
	})
	if str(result.get("result_type", "")) == "ok":
		for evt in result.get("events", []):
			_log_event(evt)
		ui_pending_purchases.clear()
		_refresh_all()
	else:
		var err: Dictionary = result.get("error", {})
		_log_system("Purchase failed [%s]: %s" % [str(err.get("code", "UNKNOWN")), str(err.get("message", ""))])

func _on_cancel_purchase_pressed() -> void:
	ui_pending_purchases.clear()
	_refresh_purchase_panels(session.get_state() if session else {})

func _on_spawn_infantry_pressed() -> void:
	var phase := _current_phase()
	if phase == "purchase":
		_on_catalog_buy("infantry", 1)
		return
	if phase == "mobilize":
		var region_id := _selected_region_id()
		if region_id.is_empty():
			_log_system("Select a region before placing units.")
			return
		_apply_command("place_units", {
			"placements": [{
				"region_id": region_id,
				"units": [{"unit_type_id": "infantry", "count": 1}],
			}],
		})
		return
	_log_system("Spawn only works in purchase or mobilize. Phase: %s" % phase)

func _on_move_unit_pressed() -> void:
	var from_region := _selected_region_id()
	if from_region.is_empty():
		_log_system("Select a source region first.")
		return
	var to_region := ""
	if session and session.state:
		var neighbors: Array = session.state.get_adjacent_regions(from_region)
		if not neighbors.is_empty():
			to_region = str(neighbors[0])
	if to_region.is_empty():
		_log_system("No adjacent region found for %s." % from_region)
		return
	var move_units := _first_movable_stack(from_region, _selected_faction_id())
	if move_units.is_empty():
		_log_system("No movable units for current faction in %s." % from_region)
		return
	_apply_command("move_units", {"moves": [{"from_region_id": from_region, "to_region_id": to_region, "units": [move_units]}]})

func _on_end_phase_pressed() -> void:
	_apply_command("end_phase", {})

func _on_end_turn_pressed() -> void:
	_apply_command("end_turn", {})

func _apply_command(type_name: String, payload: Dictionary) -> void:
	if session == null:
		_log_system("Session not ready.")
		return
	var result: Dictionary = session.apply_command({
		"command_id": _next_command_id(),
		"player_id": _selected_faction_id(),
		"type": type_name,
		"payload": payload,
	})
	if str(result.get("result_type", "")) == "ok":
		for event_dict in result.get("events", []):
			_log_event(event_dict)
	else:
		var err: Dictionary = result.get("error", {})
		_log_system("Command failed [%s]: %s" % [str(err.get("code", "UNKNOWN")), str(err.get("message", ""))])
	_refresh_all()

func _refresh_all() -> void:
	if session == null:
		return
	var snapshot: Dictionary = session.get_state()
	_update_state_label(snapshot)
	on_state_updated(snapshot)
	_refresh_purchase_panels(snapshot)
	_refresh_region_info(_selected_region_id())
	_refresh_region_stack(_selected_region_id(), snapshot)
	if map_root and map_root.has_method("update_from_snapshot"):
		map_root.call("update_from_snapshot", snapshot)
	if map_root and map_root.has_method("update_region_colors"):
		map_root.call("update_region_colors", snapshot)
	if unit_visualizer and unit_visualizer.has_method("refresh_from_snapshot"):
		var phase := str(snapshot.get("turn_info", {}).get("current_phase", ""))
		var faction := str(snapshot.get("turn_info", {}).get("current_faction_id", ""))
		var adjacency: Dictionary = session.state.adjacency if session and session.state else {}
		unit_visualizer.call("refresh_from_snapshot", snapshot, map_root, adjacency, phase, faction)
	if battle_overlay:
		battle_overlay.visible = str(snapshot.get("turn_info", {}).get("current_phase", "")) == "combat"

func _update_phase_ui(phase: String) -> void:
	if right_ui_root:
		right_ui_root.visible = phase == "purchase"

func on_state_updated(new_state: Dictionary) -> void:
	var phase := str(new_state.get("current_phase", ""))
	if phase.is_empty():
		phase = str(new_state.get("turn_info", {}).get("current_phase", ""))
	_update_phase_ui(phase)
	if purchase_panel:
		purchase_panel.visible = phase == "purchase"
	if mobilize_panel:
		mobilize_panel.visible = phase == "mobilize"
	# Legacy nodes still remain outside PurchasePanel in this scene; hide them phase-wise as well.
	var purchase_visible := phase == "purchase"
	if ipc_allies_label:
		ipc_allies_label.visible = purchase_visible
	if ipc_axis_label:
		ipc_axis_label.visible = purchase_visible
	if unit_catalog:
		unit_catalog.visible = purchase_visible
	if pending_list:
		pending_list.visible = purchase_visible
	if pending_total_label:
		pending_total_label.visible = purchase_visible
	if purchase_confirm_button:
		purchase_confirm_button.visible = purchase_visible
	if cancel_purchase_button:
		cancel_purchase_button.visible = purchase_visible

func _refresh_region_info(selected_region_id: String) -> void:
	if region_name_label == null or session == null:
		return
	if selected_region_id == "":
		region_name_label.text = "Region: —"
		region_owner_label.text = "Owner: —"
		region_unitcount_label.text = "Units: —"
		return
	var snapshot: Dictionary = session.get_state()
	var region_entry: Dictionary = {}
	for entry in snapshot.get("regions", []):
		if str(entry.get("region_id", "")) == selected_region_id:
			region_entry = entry
			break
	region_name_label.text = "Region: %s" % selected_region_id
	var owner := str(region_entry.get("owner_faction_id", "neutral"))
	region_owner_label.text = "Owner: %s" % owner.capitalize()
	var units_total := 0
	for u in region_entry.get("units", []):
		units_total += int(u.get("count", 0))
	region_unitcount_label.text = "Units: %d" % units_total

func _refresh_purchase_panels(snapshot: Dictionary) -> void:
	var ipc: Dictionary = snapshot.get("ipc", {})
	if ipc_allies_label:
		ipc_allies_label.text = "Allies IPC: %s" % str(ipc.get("allies", 0))
	if ipc_axis_label:
		ipc_axis_label.text = "Axis IPC: %s" % str(ipc.get("axis", 0))

	var merged: Dictionary = {}
	var server_pending: Array = snapshot.get("pending_purchases", {}).get(_selected_faction_id(), [])
	for line in server_pending:
		merged[str(line.get("unit_type_id", ""))] = int(line.get("count", 0))
	for unit_type_id in ui_pending_purchases.keys():
		merged[unit_type_id] = int(merged.get(unit_type_id, 0)) + int(ui_pending_purchases[unit_type_id])

	if pending_list:
		for c in pending_list.get_children():
			c.queue_free()
	var total_cost := 0
	for unit_type_id in merged.keys():
		var count := int(merged[unit_type_id])
		var cost := _unit_cost(unit_type_id) * count
		total_cost += cost
		if pending_list:
			var row := HBoxContainer.new()
			var label := Label.new()
			label.text = "%s x%d (cost %d)" % [unit_type_id, count, cost]
			row.add_child(label)
			if ui_pending_purchases.has(unit_type_id):
				var cancel_btn := Button.new()
				cancel_btn.text = "Cancel"
				cancel_btn.pressed.connect(func() -> void:
					ui_pending_purchases.erase(unit_type_id)
					_refresh_purchase_panels(snapshot)
				)
				row.add_child(cancel_btn)
			pending_list.add_child(row)
	if pending_total_label:
		pending_total_label.text = "Pending total: %d" % total_cost

	var remaining := int(ipc.get(_selected_faction_id(), 0)) - total_cost
	if unit_catalog:
		for row in unit_catalog.get_children():
			if row is HBoxContainer and row.get_child_count() >= 2:
				var text := (row.get_child(0) as Label).text.to_lower()
				var buy_btn := row.get_child(1) as Button
				var utid := text.split(" ")[0]
				buy_btn.disabled = _unit_cost(utid) > remaining or _current_phase() != "purchase"
	_refresh_mobilize_staged_list(snapshot)

func _refresh_mobilize_staged_list(snapshot: Dictionary) -> void:
	if staged_units_list == null:
		return
	for child in staged_units_list.get_children():
		child.queue_free()
	var faction_pending: Array = snapshot.get("pending_purchases", {}).get(_selected_faction_id(), [])
	for line in faction_pending:
		var unit_type_id := str(line.get("unit_type_id", ""))
		var count := int(line.get("count", 0))
		if count <= 0:
			continue
		var row := HBoxContainer.new()
		var label := Label.new()
		label.text = "%s x%d" % [unit_type_id.capitalize(), count]
		row.add_child(label)
		var icon: TextureRect = DraggableStagedIconScript.new()
		icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		icon.custom_minimum_size = Vector2(48, 48)
		icon.texture = _get_unit_texture(unit_type_id, _selected_faction_id())
		icon.drag_data = {
			"unit_type_id": unit_type_id,
			"count": 1,
		}
		icon.dropped_on_map.connect(_on_staged_drag_drop)
		row.add_child(icon)
		staged_units_list.add_child(row)

func _on_staged_drag_drop(data: Dictionary, global_position: Vector2) -> void:
	if session == null or map_root == null:
		return
	if not map_root.has_method("drop_staged_unit"):
		return
	var result: Dictionary = map_root.call("drop_staged_unit", global_position, data, session, _next_command_id(), _selected_faction_id())
	if str(result.get("result_type", "")) == "ok":
		for event_dict in result.get("events", []):
			_log_event(event_dict)
		_refresh_all()
	else:
		var err: Dictionary = result.get("error", {})
		_log_system("Place failed [%s]: %s" % [str(err.get("code", "UNKNOWN")), str(err.get("message", ""))])
		_refresh_all()

func _refresh_region_stack(selected_region_id: String, snapshot: Dictionary) -> void:
	if region_stack_list == null:
		return
	if map_root and map_root.has_method("show_region_stack"):
		map_root.call("show_region_stack", selected_region_id, snapshot, region_stack_list)
		return
	for child in region_stack_list.get_children():
		child.queue_free()
	var header := Label.new()
	header.text = "Region Stack"
	region_stack_list.add_child(header)
	if selected_region_id.is_empty():
		var empty := Label.new()
		empty.text = "Select a region."
		region_stack_list.add_child(empty)
		return
	for region_entry in snapshot.get("regions", []):
		if str(region_entry.get("region_id", "")) != selected_region_id:
			continue
		var grouped := {"allies": {}, "axis": {}, "neutral": {}}
		for u in region_entry.get("units", []):
			var faction := str(u.get("faction_id", "neutral")).to_lower()
			if not grouped.has(faction):
				grouped[faction] = {}
			var unit_type_id := str(u.get("unit_type_id", ""))
			grouped[faction][unit_type_id] = int(grouped[faction].get(unit_type_id, 0)) + int(u.get("count", 0))
		for faction in grouped.keys():
			for unit_type_id in grouped[faction].keys():
				var row := Label.new()
				row.text = "%s: %s x%d" % [faction.capitalize(), unit_type_id, int(grouped[faction][unit_type_id])]
				region_stack_list.add_child(row)
		return

func _update_state_label(snapshot: Dictionary) -> void:
	if state_label == null:
		return
	var turn_info: Dictionary = snapshot.get("turn_info", {})
	var ipc: Dictionary = snapshot.get("ipc", {})
	state_label.text = "Turn %s  Round %s\nActive: %s  Phase: %s\nIPC allies: %s  axis: %s\nSelected faction: %s" % [
		str(turn_info.get("turn_number", "?")),
		str(snapshot.get("game_round", "?")),
		str(turn_info.get("current_faction_id", "")).capitalize(),
		str(turn_info.get("current_phase", "")),
		str(ipc.get("allies", 0)),
		str(ipc.get("axis", 0)),
		_selected_faction_display(),
	]

func _first_movable_stack(region_id: String, faction_id: String) -> Dictionary:
	if session == null:
		return {}
	for unit_entry in session.state.get_faction_units_in_region(region_id, faction_id):
		if typeof(unit_entry) != TYPE_DICTIONARY:
			continue
		if unit_entry.has("instance_id"):
			continue
		return {"unit_type_id": str(unit_entry.get("unit_type_id", "")), "count": 1}
	return {}

func _selected_faction_id() -> String:
	if faction_selector == null:
		return "allies"
	return faction_selector.get_item_text(faction_selector.selected).to_lower()

func _selected_faction_display() -> String:
	if faction_selector == null:
		return "Allies"
	return faction_selector.get_item_text(faction_selector.selected)

func _selected_region_id() -> String:
	if map_root and map_root.has_method("get_selected_region_id"):
		return str(map_root.call("get_selected_region_id"))
	return ""

func _current_phase() -> String:
	if session and session.state:
		return str(session.state.current_phase)
	return ""

func _next_command_id() -> String:
	_command_counter += 1
	return "gsc_%04d" % _command_counter

func _unit_cost(unit_type_id: String) -> int:
	if session and session.has_method("get_state"):
		var costs: Dictionary = session.get_state().get("cost_table", {})
		return int(costs.get(unit_type_id, 0))
	return 0

func _on_unit_movement_drop(
	from_region_id: String,
	to_region_id: String,
	unit_type_id: String,
	count: int
) -> void:
	_apply_command("move_units", {
		"moves": [{
			"from_region_id": from_region_id,
			"to_region_id": to_region_id,
			"units": [{"unit_type_id": unit_type_id, "count": count}],
		}],
	})


func _on_region_selected(region_id: String) -> void:
	_refresh_region_info(region_id)
	_refresh_region_stack(region_id, session.get_state() if session else {})
	_log_system("Selected region: %s" % region_id)

func _get_unit_texture(unit_type_id: String, faction: String) -> Texture2D:
	if unit_visualizer and unit_visualizer.has_method("_load_unit_texture"):
		return unit_visualizer.call("_load_unit_texture", unit_type_id, faction)
	return UnitTextureCache.get_texture(unit_type_id, faction)

func _log_event(event_dict: Dictionary) -> void:
	if event_log:
		event_log.append_text("%s\n" % JSON.stringify(event_dict))

func _log_system(message: String) -> void:
	if event_log:
		event_log.append_text("[system] %s\n" % message)
