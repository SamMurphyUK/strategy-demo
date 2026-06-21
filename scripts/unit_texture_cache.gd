extends RefCounted
class_name UnitTextureCache

static var _cache: Dictionary = {}

const TEXTURE_ROOT := "res://texture/units/"

const TEXTURE_ALIASES := {
	"strategic_bomber": "fighter",
	"tactical_bomber": "fighter",
	"destroyer": "battleship",
	"cruiser": "battleship",
	"submarine": "battleship",
	"carrier": "battleship",
	"mech_infantry": "infantry",
}

const DEBUG_UNIT_TYPES := [
	"infantry",
	"artillery",
	"tank",
	"battleship",
	"transport",
	"fighter",
	"factory",
]

const DEBUG_FACTIONS := ["allies", "axis"]

const _FACTION_SUFFIXES := ["allies", "axis"]


static func normalize_unit_type_and_faction(unit_type_id: String, faction_id: String) -> Dictionary:
	var unit := unit_type_id.to_lower().strip_edges()
	var faction := faction_id.to_lower().strip_edges()

	for suffix in _FACTION_SUFFIXES:
		if unit.ends_with(suffix) and unit.length() > suffix.length():
			faction = suffix
			unit = unit.substr(0, unit.length() - suffix.length())
			break

	match faction:
		"allies", "american", "us":
			faction = "allies"
		"axis", "ger", "germany", "german":
			faction = "axis"

	return {"unit_type_id": unit, "faction_id": faction}


static func normalize_faction_id(faction_id: String) -> String:
	return str(normalize_unit_type_and_faction("", faction_id)["faction_id"])


static func _folder_for_faction(faction: String) -> String:
	var f := faction.to_lower()
	match f:
		"allies":
			return "us"
		"axis":
			return "ger"
		_:
			return "neutral"


static func build_path(unit_type_id: String, faction_id: String) -> String:
	var folder := _folder_for_faction(faction_id)
	var u := unit_type_id.to_lower()
	return "%s%s/%s.png" % [TEXTURE_ROOT, folder, u]


static func get_texture(unit_type_id: String, faction_id: String) -> Texture2D:
	var normalized := normalize_unit_type_and_faction(unit_type_id, faction_id)
	var unit := str(normalized["unit_type_id"])
	var faction := str(normalized["faction_id"])
	if unit.is_empty():
		return null

	var folder := _folder_for_faction(faction)
	var key := "%s|%s" % [folder, unit]
	if _cache.has(key):
		return _cache[key]

	var path := "%s%s/%s.png" % [TEXTURE_ROOT, folder, unit]
	if ResourceLoader.exists(path):
		var tex: Texture2D = load(path)
		if tex != null:
			_cache[key] = tex
		return tex

	if TEXTURE_ALIASES.has(unit):
		var alias := str(TEXTURE_ALIASES[unit])
		var alias_path := "%s%s/%s.png" % [TEXTURE_ROOT, folder, alias]
		if ResourceLoader.exists(alias_path):
			var alias_tex: Texture2D = load(alias_path)
			if alias_tex != null:
				_cache[key] = alias_tex
				return alias_tex

	var fallback := "%sneutral/%s.png" % [TEXTURE_ROOT, unit]
	if ResourceLoader.exists(fallback):
		var fallback_tex: Texture2D = load(fallback)
		if fallback_tex != null:
			_cache[key] = fallback_tex
		return fallback_tex

	return null


static func clear_cache() -> void:
	_cache.clear()


static func debug_print_all_unit_textures() -> void:
	for faction_id in DEBUG_FACTIONS:
		for unit_type in DEBUG_UNIT_TYPES:
			var path := build_path(unit_type, faction_id)
			if ResourceLoader.exists(path):
				get_texture(unit_type, faction_id)
