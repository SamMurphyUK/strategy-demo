extends GutTest

func test_germany_borders_france() -> void:
	var session = GameSessionFactory.create(GameSessionFactory.Mode.STUB)
	var neighbors: Array = session.state.get_adjacent_regions("Germany")
	assert_gt(neighbors.size(), 0, "Germany should border at least one region on demomap01")
	assert_true("France" in neighbors)
