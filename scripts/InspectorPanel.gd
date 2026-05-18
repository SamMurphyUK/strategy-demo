extends VBoxContainer

var region: Node2D = null

func set_region(r: Node2D):
	region = r

	var meta = r.get_node_or_null("RegionMetadata")
	if meta == null:
		push_error("RegionMetadata missing on region: " + str(r))
		return

	$RegionIDField.text = meta.region_id
	$IPCField.value = meta.ipc_value
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
	meta.is_victory_city = $VictoryCityCheckbox.button_pressed
	meta.has_factory = $FactoryCheckbox.button_pressed
