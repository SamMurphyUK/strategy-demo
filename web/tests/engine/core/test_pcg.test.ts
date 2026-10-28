import { describe, expect, it } from "vitest";
import { PCG } from "../../../src/engine";

describe("core/test_pcg", () => {
  it("test_deterministic_output", () => {
    const rng1 = new PCG(12345, 1);
    const rng2 = new PCG(12345, 1);
    for (let i = 0; i < 100; i++) {
      expect(rng1.nextInt(), "RNG should be deterministic").toBe(rng2.nextInt());
    }
  });

  it("test_different_seeds_produce_different_output", () => {
    const rng1 = new PCG(12345, 1);
    const rng2 = new PCG(54321, 1);
    let sameCount = 0;
    for (let i = 0; i < 100; i++) {
      if (rng1.nextInt() === rng2.nextInt()) {
        sameCount += 1;
      }
    }
    expect(sameCount < 10, "Different seeds should produce different sequences").toBe(true);
  });

  it("test_roll_d6_range", () => {
    const rng = new PCG(12345, 1);
    for (let i = 0; i < 1000; i++) {
      const roll = rng.rollD6();
      expect(roll >= 1 && roll <= 6, `d6 must be 1-6, got ${roll}`).toBe(true);
    }
  });

  it("test_roll_d6_distribution", () => {
    const rng = new PCG(99999, 1);
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    for (let i = 0; i < 6000; i++) {
      counts[rng.rollD6()] += 1;
    }
    for (const val of Object.keys(counts)) {
      const c = counts[Number(val)];
      expect(c > 700 && c < 1300, `Value ${val} appeared ${c} times, expected ~1000`).toBe(true);
    }
  });

  it("test_from_seed", () => {
    const rng = PCG.fromSeed({ state: 99999, sequence: 42 });
    expect(rng, "from_seed should return valid PCG").not.toBeNull();
    const val = rng.nextInt();
    expect(val >= 0, "Should produce valid output").toBe(true);
  });

  it("test_get_state_returns_current_state", () => {
    const rng = new PCG(12345, 1);
    rng.nextInt();
    rng.nextInt();
    const state = rng.getState();
    expect("state" in state, "Should have state key").toBe(true);
    expect("sequence" in state, "Should have sequence key").toBe(true);
  });
});
