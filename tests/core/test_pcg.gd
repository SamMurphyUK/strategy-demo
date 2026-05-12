extends GutTest


func test_deterministic_output() -> void:
	var rng1 := PCG.new(12345, 1)
	var rng2 := PCG.new(12345, 1)
	for i in range(100):
		assert_eq(rng1.next_int(), rng2.next_int(), "RNG should be deterministic")


func test_different_seeds_produce_different_output() -> void:
	var rng1 := PCG.new(12345, 1)
	var rng2 := PCG.new(54321, 1)
	var same_count := 0
	for i in range(100):
		if rng1.next_int() == rng2.next_int():
			same_count += 1
	assert_true(same_count < 10, "Different seeds should produce different sequences")


func test_roll_d6_range() -> void:
	var rng := PCG.new(12345, 1)
	for i in range(1000):
		var roll := rng.roll_d6()
		assert_true(roll >= 1 and roll <= 6, "d6 must be 1-6, got %d" % roll)


func test_roll_d6_distribution() -> void:
	var rng := PCG.new(99999, 1)
	var counts := {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0}
	for i in range(6000):
		counts[rng.roll_d6()] += 1
	for val in counts:
		assert_true(counts[val] > 700 and counts[val] < 1300,
			"Value %d appeared %d times, expected ~1000" % [val, counts[val]])


func test_from_seed() -> void:
	var seed_dict := {"state": 99999, "sequence": 42}
	var rng := PCG.from_seed(seed_dict)
	assert_not_null(rng, "from_seed should return valid PCG")
	var val := rng.next_int()
	assert_true(val >= 0, "Should produce valid output")


func test_get_state_returns_current_state() -> void:
	var rng := PCG.new(12345, 1)
	rng.next_int()
	rng.next_int()
	var state := rng.get_state()
	assert_true("state" in state, "Should have state key")
	assert_true("sequence" in state, "Should have sequence key")
