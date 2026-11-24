class_name PlacementBatch
extends RefCounted

var placements: Array = []  # Array of {unit_type: String, region_id: String, quantity: int}
var faction_id: String
var total_cost: int = 0


func _init(p_faction_id: String = "") -> void:
    faction_id = p_faction_id


func add_placement(unit_type: String, region_id: String, quantity: int = 1) -> void:
    placements.append({
        "unit_type": unit_type,
        "region_id": region_id,
        "quantity": quantity
    })


func get_placements_for_region(region_id: String) -> Array:
    var result: Array = []
    for p in placements:
        if p["region_id"] == region_id:
            result.append(p)
    return result


func get_total_units() -> int:
    var total := 0
    for p in placements:
        total += p["quantity"]
    return total


func clear() -> void:
    placements.clear()
    total_cost = 0
