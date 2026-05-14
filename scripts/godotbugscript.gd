extends Node

func _ready():
	print("=== GLOBAL CLASS REGISTRY ===")
	var found := false

	for c in ProjectSettings.get_global_class_list():
		if c.has("class") and c["class"] == "PlaneLandingRequirement":
			print("FOUND CLASS REGISTRATION:")
			print(c)
			found = true

	if not found:
		print("PlaneLandingRequirement NOT REGISTERED")

	get_tree().quit()
