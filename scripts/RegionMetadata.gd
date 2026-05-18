extends Node
class_name RegionMetadata

@export var region_id: String = ""
@export var ipc_value: int = 0
@export var faction: String = ""
@export var is_victory_city: bool = false
@export var has_factory: bool = false

func to_dict() -> Dictionary:
    return {
        "region_id": region_id,
        "ipc": ipc_value,
        "faction": faction,
        "victory": is_victory_city,
        "factory": has_factory
    }
