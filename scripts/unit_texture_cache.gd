extends RefCounted
class_name UnitTextureCache

static var _cache: Dictionary = {}

const BASE_TEXTURES := "res://textures/units/"
const LEGACY_TEXTURES := "res://texture/units/"
const FACTORY_PLACEHOLDER := "res://textures/units/factory_placeholder.png"

const FACTION_FOLDERS := {
	"allies": ["american", "allies", "us"],
	"axis": ["ger", "axis", "germany"],
	"american": ["american", "allies", "us"],
	"ger": ["ger", "axis", "germany"],
	"germany": ["ger", "axis", "germany"],
	"us": ["american", "allies", "us"],
}

const FACTION_PREFIX := {
	"allies": "allies",
	"axis": "axis",
	"american": "allies",
	"ger": "axis",
	"germany": "axis",
	"us": "allies",
}


static func get_texture(unit_type: String, faction: String) -> Texture2D:
	var key := "%s|%s" % [faction.to_lower(), unit_type.to_lower()]
	if _cache.has(key):
		return _cache[key]

	var tex := _load_texture(unit_type, faction)
	if tex != null:
		_cache[key] = tex
	return tex


static func clear_cache() -> void:
	_cache.clear()


static func _load_texture(unit_type: String, faction: String) -> Texture2D:
	var ut := unit_type.to_lower()
	var fid := faction.to_lower()

	if ut == "factory":
		if ResourceLoader.exists(FACTORY_PLACEHOLDER):
			return load(FACTORY_PLACEHOLDER)

	var folders: Array = FACTION_FOLDERS.get(fid, [fid])
	for folder in folders:
		var path := "%s%s/%s.png" % [BASE_TEXTURES, folder, ut]
		if ResourceLoader.exists(path):
			return load(path)

	var prefix: String = str(FACTION_PREFIX.get(fid, fid))
	var flat := "%s%s_%s.png" % [BASE_TEXTURES, prefix, ut]
	if ResourceLoader.exists(flat):
		return load(flat)

	for legacy_folder in folders:
		var legacy := "%s%s/%s.png" % [LEGACY_TEXTURES, legacy_folder, ut]
		if ResourceLoader.exists(legacy):
			return load(legacy)

	return null
