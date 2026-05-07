extends GutTest

func test_deterministic_output() -> void:
	var rng1 := PCG.new(12345, 1)
	var rng2 := PCG.new(12345, 1)
	for i in range(100):
		assert_eq(rng1.next_int(), rng2.next_int())

func test_roll_d6_range() -> void:
	var rng := PCG.new(12345, 1)
	for i in range(1000):
		var roll := rng.roll_d6()
		assert_true(roll >= 1 and roll <= 6)