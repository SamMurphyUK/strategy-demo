extends SceneTree

func _init() -> void:
	var scene_path = "res://scenes/UnitIcon.tscn"
	print("exists:", ResourceLoader.exists(scene_path))
	var p = ResourceLoader.load(scene_path)
	if p:
		var inst = p.instantiate()
		print("instantiated:", inst)
	else:
		print("failed to load UnitIcon.tscn")
	var tex := UnitTextureCache.get_texture("infantry", "allies")
	print("tex loaded:", tex != null)
	quit()
