extends Node2D
class_name RegionHelper

func get_anchor_by_index(index: int) -> Node2D:
    return get_node_or_null("Anchor_" + str(index))

func get_anchor_by_name(name: String) -> Node2D:
    return get_node_or_null(name)

func reserve_anchor_by_name(name: String) -> bool:
    var a = get_node_or_null(name)
    if a == null:
        return false
    var occ = a.get_meta("occupied", 0)
    var cap = a.get_meta("capacity", 1)
    if occ >= cap:
        return false
    a.set_meta("occupied", occ + 1)
    return true

func release_anchor_by_name(name: String) -> void:
    var a = get_node_or_null(name)
    if a:
        var occ = a.get_meta("occupied", 0)
        a.set_meta("occupied", max(0, occ - 1))

func get_anchor_global_position(name: String) -> Vector2:
    var a = get_node_or_null(name)
    return a.global_position if a else global_position
