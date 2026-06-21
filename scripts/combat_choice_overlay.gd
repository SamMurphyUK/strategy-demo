extends CanvasLayer
class_name CombatChoiceOverlay

signal bomb_requested(region_id: String)
signal resolve_battles_requested()

@onready var panel: PanelContainer = $PanelRoot/Panel
@onready var title_label: Label = $PanelRoot/Panel/Margin/VBox/TitleLabel
@onready var choices_vbox: VBoxContainer = $PanelRoot/Panel/Margin/VBox/ChoicesVBox
@onready var resolve_button: Button = $PanelRoot/Panel/Margin/VBox/ResolveButton

var _session = null


func _ready() -> void:
	visible = false
	if resolve_button:
		resolve_button.pressed.connect(_on_resolve_pressed)


func configure(session) -> void:
	_session = session


func refresh() -> void:
	if _session == null or _session.state == null:
		visible = false
		return
	var phase := str(_session.state.current_phase)
	if phase != "combat":
		visible = false
		return
	var faction := str(_session.state.current_faction_id)
	var bombs: Array = RegionUnitDisplay.regions_with_bomb_targets(_session.state, faction)
	var battles: Array = _pending_battles(faction)
	if bombs.is_empty() and battles.is_empty():
		visible = false
		return
	visible = true
	if title_label:
		title_label.text = "Combat Phase — choose actions"
	_clear_choices()
	if not bombs.is_empty():
		var header := Label.new()
		header.text = "Strategic bombing (enemy factories):"
		choices_vbox.add_child(header)
		for region_id in bombs:
			var count := RegionUnitDisplay.bomb_unit_count(_session.state, str(region_id), faction)
			var btn := Button.new()
			btn.text = "Bomb %s (%d bomber(s))" % [region_id, count]
			var rid := str(region_id)
			btn.pressed.connect(func() -> void: bomb_requested.emit(rid))
			choices_vbox.add_child(btn)
	if not battles.is_empty():
		var battle_header := Label.new()
		battle_header.text = "Land/sea battles pending:"
		choices_vbox.add_child(battle_header)
		for battle in battles:
			var region_id := str(battle.get("region_id", ""))
			var btn := Button.new()
			btn.text = "Join attack at %s" % region_id
			btn.pressed.connect(func() -> void: resolve_battles_requested.emit())
			choices_vbox.add_child(btn)


func _pending_battles(faction: String) -> Array:
	if _session == null or not _session.has_method("get_pending_battles"):
		return []
	return _session.call("get_pending_battles", faction)


func _clear_choices() -> void:
	if choices_vbox == null:
		return
	for child in choices_vbox.get_children():
		child.queue_free()


func _on_resolve_pressed() -> void:
	resolve_battles_requested.emit()
