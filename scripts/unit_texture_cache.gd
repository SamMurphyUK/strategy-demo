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

const DEBUG_FACTIONS := ["us", "ger"]


static func faction_folder(faction_id: String) -> String:
	match faction_id.to_lower():
		"allies", "american", "us":
			return "us"
		"axis", "ger", "germany":
			return "ger"
		_:
			return faction_id.to_lower()


static func build_path(unit_type_id: String, faction_id: String) -> String:
	var folder := faction_folder(faction_id)
	var unit := unit_type_id.to_lower()
	return "%s%s/%s.png" % [TEXTURE_ROOT, folder, unit]


static func get_texture(unit_type_id: String, faction_id: String) -> Texture2D:
	var key := "%s|%s" % [faction_folder(faction_id), unit_type_id.to_lower()]
	if _cache.has(key):
		return _cache[key]

	var path := build_path(unit_type_id, faction_id)
	print("[TEX] Loading:", path, "exists:", ResourceLoader.exists(path))
	if not ResourceLoader.exists(path):
		return null

	var tex: Texture2D = load(path)
	if tex != null:
		_cache[key] = tex
	return tex


static func clear_cache() -> void:
	_cache.clear()


static func debug_print_all_unit_textures() -> void:
	print("[TEX] === Unit texture startup audit ===")
	for folder in DEBUG_FACTIONS:
		for unit_type in DEBUG_UNIT_TYPES:
			var path := "%s%s/%s.png" % [TEXTURE_ROOT, folder, unit_type]
			var exists := ResourceLoader.exists(path)
			var absolute := ProjectSettings.globalize_path(path) if exists else "(missing)"
			print("[TEX] startup:", path, "exists:", exists, "absolute:", absolute)
			if exists:
				get_texture(unit_type, folder)
	print("[TEX] === End unit texture audit ===")
