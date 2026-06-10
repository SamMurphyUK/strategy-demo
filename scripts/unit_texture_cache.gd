extends RefCounted
class_name UnitTextureCache

static var _cache: Dictionary = {}

const TEXTURE_ROOT := "res://texture/units/"

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
	var folder := _folder_for_faction(faction_id)
	var u := unit_type_id.to_lower()
	var key := "%s|%s" % [folder, u]
	if _cache.has(key):
		return _cache[key]

	var path := "%s%s/%s.png" % [TEXTURE_ROOT, folder, u]
	if ResourceLoader.exists(path):
		print("[TEX] Loading:", path)
		var tex: Texture2D = load(path)
		if tex != null:
			_cache[key] = tex
		return tex

	var fallback := "%sneutral/%s.png" % [TEXTURE_ROOT, u]
	if ResourceLoader.exists(fallback):
		print("[TEX] Fallback:", fallback)
		var fallback_tex: Texture2D = load(fallback)
		if fallback_tex != null:
			_cache[key] = fallback_tex
		return fallback_tex

	print("[TEX] Missing:", faction_id, unit_type_id, "->", path)
	return null


static func clear_cache() -> void:
	_cache.clear()


static func debug_print_all_unit_textures() -> void:
	print("[TEX] === Unit texture startup audit ===")
	for faction_id in DEBUG_FACTIONS:
		for unit_type in DEBUG_UNIT_TYPES:
			var path := build_path(unit_type, faction_id)
			var exists := ResourceLoader.exists(path)
			var absolute := ProjectSettings.globalize_path(path) if exists else "(missing)"
			print("[TEX] startup:", path, "exists:", exists, "absolute:", absolute)
			if exists:
				get_texture(unit_type, faction_id)
	print("[TEX] === End unit texture audit ===")
