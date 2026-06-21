extends Control
class_name RegionInspectorPanel

signal expand_toggled(expanded: bool)

enum ViewMode { REGION, COMBAT }

const InspectorUnitChipScript := preload("res://scripts/inspector_unit_chip.gd")

@onready var collapsed_bar: HBoxContainer = $CollapsedBar
@onready var title_label: Label = $CollapsedBar/TitleLabel
@onready var expand_button: Button = $CollapsedBar/ExpandButton
@onready var expanded_panel: PanelContainer = $ExpandedPanel
@onready var expanded_title: Label = $ExpandedPanel/ExpandedMargin/ExpandedVBox/ExpandedTitle
@onready var units_scroll: ScrollContainer = $ExpandedPanel/ExpandedMargin/ExpandedVBox/UnitsScroll
@onready var units_row: HBoxContainer = $ExpandedPanel/ExpandedMargin/ExpandedVBox/UnitsScroll/UnitsRow
@onready var scroll_tab: Panel = $ExpandedPanel/ExpandedMargin/ExpandedVBox/ScrollTab
@onready var collapse_button: Button = $ExpandedPanel/ExpandedMargin/ExpandedVBox/CollapseButton

var _session = null
var _region_id: String = ""
var _view_mode: ViewMode = ViewMode.REGION
var _expanded: bool = false
var _viewer_faction: String = "allies"
var _scroll_dragging: bool = false
var _scroll_drag_start_x: float = 0.0
var _scroll_drag_start_value: float = 0.0


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	if expand_button:
		expand_button.pressed.connect(_on_expand_pressed)
	if collapse_button:
		collapse_button.pressed.connect(_on_collapse_pressed)
	if scroll_tab:
		scroll_tab.gui_input.connect(_on_scroll_tab_gui_input)
	_set_expanded(false)
	visible = false


func configure(session) -> void:
	_session = session


func set_viewer_faction(faction_id: String) -> void:
	_viewer_faction = faction_id.to_lower()


func show_region(region_id: String) -> void:
	_region_id = region_id
	_view_mode = ViewMode.REGION
	visible = not region_id.is_empty()
	_refresh()


func show_combat_info(region_id: String) -> void:
	_region_id = region_id
	_view_mode = ViewMode.COMBAT
	visible = not region_id.is_empty()
	if not _expanded:
		_set_expanded(true)
	_refresh()


func get_view_mode() -> ViewMode:
	return _view_mode


func set_region_view(region_id: String) -> void:
	_region_id = region_id
	_view_mode = ViewMode.REGION
	visible = not region_id.is_empty()
	_refresh()


func refresh() -> void:
	if _region_id.is_empty():
		visible = false
		return
	_refresh()


func clear_selection() -> void:
	_region_id = ""
	_view_mode = ViewMode.REGION
	visible = false
	_clear_units_row()


func _refresh() -> void:
	if _region_id.is_empty():
		return
	var title := _build_title()
	if title_label:
		title_label.text = title
	if expanded_title:
		expanded_title.text = title
	_populate_units()
	_update_scroll_tab_visibility()


func _build_title() -> String:
	if _view_mode == ViewMode.COMBAT:
		return "Combat Info"
	return _region_id


func _populate_units() -> void:
	_clear_units_row()
	if units_row == null or _session == null or _session.state == null:
		return
	var state: GameState = _session.state
	var entries: Array = []
	if _view_mode == ViewMode.COMBAT:
		entries = RegionUnitDisplay.combat_pool_entries(state, _region_id, _viewer_faction)
	else:
		entries = RegionUnitDisplay.entries_for_region_inspector(state, _region_id, _viewer_faction)
	for entry in entries:
		if int(entry.get("count", 0)) <= 0:
			continue
		var chip: InspectorUnitChip = InspectorUnitChipScript.new()
		chip.configure(
			str(entry.get("unit_type_id", "")),
			str(entry.get("faction_id", "")),
			int(entry.get("count", 1))
		)
		units_row.add_child(chip)


func _clear_units_row() -> void:
	if units_row == null:
		return
	for child in units_row.get_children():
		child.queue_free()


func _update_scroll_tab_visibility() -> void:
	if scroll_tab == null or units_scroll == null:
		return
	call_deferred("_deferred_update_scroll_tab")


func _deferred_update_scroll_tab() -> void:
	if scroll_tab == null or units_scroll == null:
		return
	var hbar := units_scroll.get_h_scroll_bar()
	if hbar == null:
		scroll_tab.visible = false
		return
	scroll_tab.visible = hbar.max_value > 0.0


func _on_expand_pressed() -> void:
	_set_expanded(true)


func _on_collapse_pressed() -> void:
	_set_expanded(false)


func _set_expanded(expanded: bool) -> void:
	_expanded = expanded
	if collapsed_bar:
		collapsed_bar.visible = not expanded
	if expanded_panel:
		expanded_panel.visible = expanded
	if expand_button:
		expand_button.text = "▲" if expanded else "▼"
	expand_toggled.emit(expanded)
	if expanded:
		call_deferred("_update_scroll_tab_visibility")


func _on_scroll_tab_gui_input(event: InputEvent) -> void:
	if units_scroll == null:
		return
	var hbar := units_scroll.get_h_scroll_bar()
	if hbar == null or hbar.max_value <= 0.0:
		return
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			_scroll_dragging = true
			_scroll_drag_start_x = event.global_position.x
			_scroll_drag_start_value = hbar.value
		else:
			_scroll_dragging = false
	elif event is InputEventMouseMotion and _scroll_dragging:
		var delta: float = event.global_position.x - _scroll_drag_start_x
		var track_width := maxf(1.0, units_scroll.size.x)
		var scroll_range := hbar.max_value - hbar.min_value
		hbar.value = clampf(
			_scroll_drag_start_value + (delta / track_width) * scroll_range,
			hbar.min_value,
			hbar.max_value
		)
