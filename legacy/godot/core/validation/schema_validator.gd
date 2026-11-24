class_name SchemaValidator
extends RefCounted

var errors: Array = []

func validate_map(data: Dictionary) -> bool:
	errors.clear()
	if "regions" not in data: errors.append("Missing regions"); return false
	if "adjacency" not in data: errors.append("Missing adjacency"); return false
	return true

func validate_units(data: Dictionary) -> bool:
	errors.clear()
	if "unit_types" not in data: errors.append("Missing unit_types"); return false
	return true

func validate_factions(data: Dictionary) -> bool:
	errors.clear()
	if "factions" not in data: errors.append("Missing factions"); return false
	return true

func get_errors() -> Array:
	return errors
