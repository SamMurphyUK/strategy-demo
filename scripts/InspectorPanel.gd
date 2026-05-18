extends Control

var region = null

func set_region(r):
    region = r
    var meta = r.get_node("RegionMetadata")
    $RegionIDField.text = meta.region_id
    $IPCField.value = meta.ipc_value
    $FactionDropdown.selected = 0
    $VictoryCityCheckbox.button_pressed = meta.is_victory_city
    $FactoryCheckbox.button_pressed = meta.has_factory

func _on_ApplyButton_pressed():
    if region == null:
        return

    var meta = region.get_node("RegionMetadata")
    meta.region_id = $RegionIDField.text
    meta.ipc_value = int($IPCField.value)
    meta.is_victory_city = $VictoryCityCheckbox.button_pressed
    meta.has_factory = $FactoryCheckbox.button_pressed
