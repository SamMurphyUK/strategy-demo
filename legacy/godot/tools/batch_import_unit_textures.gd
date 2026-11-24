extends SceneTree
## Batch-apply unit icon texture import settings and reimport.
## Run: godot --headless --path . -s res://tools/batch_import_unit_textures.gd

const SCAN_ROOTS := [
	"res://texture/units/",
	"res://assets/units/",
]

const IMPORT_PARAMS := {
	"compress/mode": 0,
	"compress/high_quality": false,
	"mipmaps/generate": true,
	"mipmaps/limit": -1,
	"process/size_limit": 128,
	"process/fix_alpha_border": true,
	"process/premult_alpha": false,
	"detect_3d/compress_to": 1,
}


func _init() -> void:
	var changed := 0
	for root in SCAN_ROOTS:
		if not DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(root)):
			continue
		changed += _scan_dir(root)
	print("batch_import_unit_textures: updated ", changed, " import file(s)")
	quit()


func _scan_dir(dir_path: String) -> int:
	var count := 0
	var dir := DirAccess.open(dir_path)
	if dir == null:
		return 0
	dir.list_dir_begin()
	var entry := dir.get_next()
	while entry != "":
		if entry != "." and entry != "..":
			var full := dir_path.path_join(entry)
			if DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(full)):
				var subdir := full if full.ends_with("/") else full + "/"
				count += _scan_dir(subdir)
			elif entry.ends_with(".png"):
				if _patch_import(full):
					count += 1
		entry = dir.get_next()
	dir.list_dir_end()
	return count


func _patch_import(source_path: String) -> bool:
	var import_path := source_path + ".import"
	if not FileAccess.file_exists(import_path):
		push_warning("Missing import sidecar: ", import_path)
		return false

	var existing := FileAccess.get_file_as_string(import_path)
	var uid := _extract_line_value(existing, "uid=\"")
	var dest := _extract_line_value(existing, "path=\"")
	if dest.is_empty():
		dest = _default_dest_path(source_path)

	var lines: PackedStringArray = [
		"[remap]",
		"",
		"importer=\"texture\"",
		"type=\"CompressedTexture2D\"",
	]
	if not uid.is_empty():
		lines.append("uid=\"%s\"" % uid)
	lines.append("path=\"%s\"" % dest)
	lines.append("metadata={")
	lines.append("\"vram_texture\": false")
	lines.append("}")
	lines.append("")
	lines.append("[deps]")
	lines.append("")
	lines.append("source_file=\"%s\"" % source_path)
	lines.append("dest_files=[\"%s\"]" % dest)
	lines.append("")
	lines.append("[params]")
	lines.append("")

	var keys := IMPORT_PARAMS.keys()
	keys.sort()
	for key in keys:
		var value = IMPORT_PARAMS[key]
		if typeof(value) == TYPE_BOOL:
			lines.append("%s=%s" % [key, "true" if value else "false"])
		else:
			lines.append("%s=%s" % [key, str(value)])

	var next_text := "\n".join(lines) + "\n"
	if next_text == existing:
		return false

	var file := FileAccess.open(import_path, FileAccess.WRITE)
	if file == null:
		push_error("Failed to write: ", import_path)
		return false
	file.store_string(next_text)
	print("patched:", source_path)
	return true


func _extract_line_value(text: String, token: String) -> String:
	var idx := text.find(token)
	if idx == -1:
		return ""
	idx += token.length()
	var end := text.find("\"", idx)
	if end == -1:
		return ""
	return text.substr(idx, end - idx)


func _default_dest_path(source_path: String) -> String:
	var file_name := source_path.get_file()
	var imported_name := "%s-%s.ctex" % [file_name, file_name.md5_text()]
	return "res://.godot/imported/%s" % imported_name
