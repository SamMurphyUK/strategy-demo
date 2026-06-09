extends RefCounted
class_name UnitLayout

const ICON_SPACING := Vector2(36, 36)
const FACTORY_OFFSET := Vector2(0, -28)

const Z_ORDER := {
	"infantry": 0,
	"artillery": 1,
	"tank": 2,
	"fighter": 3,
	"plane": 3,
	"transport": 4,
	"battleship": 4,
	"factory": 5,
	"movement_arrow": 6,
}


static func get_z_order(unit_type: String) -> int:
	return int(Z_ORDER.get(unit_type.to_lower(), 0))


static func sort_unit_types(unit_types: Array) -> Array:
	var sorted: Array = unit_types.duplicate()
	sorted.sort_custom(func(a: String, b: String) -> bool:
		return get_z_order(a) < get_z_order(b)
	)
	return sorted


static func layout_positions(count: int) -> Array[Vector2]:
	var positions: Array[Vector2] = []
	if count <= 0:
		return positions

	var cols := 1
	var rows := 1
	if count <= 3:
		cols = count
		rows = 1
	elif count <= 6:
		cols = 3
		rows = 2
	else:
		cols = 3
		rows = 3

	var total_w := float(cols - 1) * ICON_SPACING.x
	var start_x := -total_w * 0.5
	var start_y := -float(rows - 1) * ICON_SPACING.y * 0.5
	var slot := 0
	for row in range(rows):
		for col in range(cols):
			if slot >= count:
				return positions
			positions.append(Vector2(start_x + col * ICON_SPACING.x, start_y + row * ICON_SPACING.y))
			slot += 1
	return positions


static func clamp_positions_to_bounds(
	positions: Array[Vector2],
	anchor: Vector2,
	bounds: Rect2,
	margin: float = 20.0
) -> Array[Vector2]:
	if bounds.size == Vector2.ZERO:
		return positions
	var clamped: Array[Vector2] = []
	var inner := bounds.grow(-margin)
	for offset in positions:
		var world := anchor + offset
		world.x = clampf(world.x, inner.position.x, inner.end.x)
		world.y = clampf(world.y, inner.position.y, inner.end.y)
		clamped.append(world - anchor)
	return clamped
