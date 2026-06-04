extends GutTest

func test_burma_has_polygon_adjacent_neighbors() -> void:
	var session = GameSessionFactory.create(GameSessionFactory.Mode.STUB)
	var neighbors: Array = session.state.get_adjacent_regions("Burma")
	assert_gt(neighbors.size(), 0, "Burma should border at least one region on demomap01")
	assert_true("India" in neighbors or "Sea Zone 01" in neighbors)
