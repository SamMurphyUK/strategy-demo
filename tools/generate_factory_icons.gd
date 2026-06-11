extends SceneTree
## Generates 128x128 factory icons for us/ger folders.
## Run: godot --headless --path . -s res://tools/generate_factory_icons.gd

const OUTPUTS := {
	"res://texture/units/us/factory.png": Color(0.35, 0.72, 0.38, 1.0),
	"res://texture/units/ger/factory.png": Color(0.62, 0.62, 0.62, 1.0),
}


func _init() -> void:
	for path in OUTPUTS.keys():
		_write_factory_icon(path, OUTPUTS[path])
		print("wrote:", path)
	quit()


func _fill_rect(img: Image, rect: Rect2i, color: Color) -> void:
	for y in range(rect.position.y, rect.position.y + rect.size.y):
		for x in range(rect.position.x, rect.position.x + rect.size.x):
			if x >= 0 and y >= 0 and x < img.get_width() and y < img.get_height():
				img.set_pixel(x, y, color)


func _write_factory_icon(path: String, body_color: Color) -> void:
	var img := Image.create(128, 128, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	var outline := body_color.darkened(0.35)
	var roof := body_color.lightened(0.12)
	var smoke := Color(0.85, 0.85, 0.85, 0.9)

	_fill_rect(img, Rect2i(28, 52, 72, 44), body_color)
	_fill_rect(img, Rect2i(28, 52, 72, 4), outline)
	_fill_rect(img, Rect2i(28, 92, 72, 4), outline)
	_fill_rect(img, Rect2i(28, 52, 4, 44), outline)
	_fill_rect(img, Rect2i(96, 52, 4, 44), outline)

	# Roof
	for y in range(40, 52):
		var t := float(y - 40) / 11.0
		var left := int(lerpf(44.0, 28.0, t))
		var right := int(lerpf(84.0, 100.0, t))
		for x in range(left, right):
			img.set_pixel(x, y, roof)

	# Chimney + smoke
	_fill_rect(img, Rect2i(78, 24, 14, 28), outline.darkened(0.1))
	_fill_rect(img, Rect2i(80, 26, 10, 24), body_color.darkened(0.15))
	_fill_rect(img, Rect2i(74, 16, 8, 8), smoke)
	_fill_rect(img, Rect2i(86, 10, 10, 10), smoke)
	_fill_rect(img, Rect2i(92, 18, 8, 8), smoke)

	# Door and windows
	_fill_rect(img, Rect2i(58, 72, 16, 24), outline.darkened(0.25))
	_fill_rect(img, Rect2i(38, 64, 12, 12), roof)
	_fill_rect(img, Rect2i(54, 64, 12, 12), roof)
	_fill_rect(img, Rect2i(70, 64, 12, 12), roof)

	img.save_png(path)
