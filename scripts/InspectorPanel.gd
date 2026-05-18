extends VBoxContainer

var region: Node2D = null

var FACTIONS := ["Neutral", "Allies", "Axis", "Independent"]

func _ready():
	$FactionDropdown.clear()
	for f in FACTIONS:
		$FactionDropdown.add_item(f)


func set_region(r: Node2D):
	region = r

	var meta = r.get_node_or_null("RegionMetadata")
	if meta == null:
		push_error("RegionMetadata missing on region: " + str(r))
		$RegionIDField.text = ""
		$IPCField.value = 0
		$FactionDropdown.select(0)
		$VictoryCityCheckbox.button_pressed = false
		$FactoryCheckbox.button_pressed = false
		return

	$RegionIDField.text = meta.region_id
	$IPCField.value = meta.ipc_value

	var idx := FACTIONS.find(meta.faction)
	if idx == -1:
		idx = 0
	$FactionDropdown.select(idx)

	$VictoryCityCheckbox.button_pressed = meta.is_victory_city
	$FactoryCheckbox.button_pressed = meta.has_factory


func _on_ApplyButton_pressed():
	if region == null:
		return

	var meta = region.get_node_or_null("RegionMetadata")
	if meta == null:
		push_error("RegionMetadata missing on region during apply.")
		return

	meta.region_id = $RegionIDField.text
	meta.ipc_value = int($IPCField.value)

	var faction_idx = $FactionDropdown.get_selected_id()
	if faction_idx >= 0 and faction_idx < FACTIONS.size():
		meta.faction = FACTIONS[faction_idx]
	else:
		meta.faction = ""

	meta.is_victory_city = $VictoryCityCheckbox.button_pressed
	meta.has_factory = $FactoryCheckbox.button_pressed

	# update on-map IPC label immediately
	var label := region.get_node_or_null("IPCLabel")
	if label:
		label.text = str(meta.ipc_value)

	# update region list label if you maintain a mapping (optional)
