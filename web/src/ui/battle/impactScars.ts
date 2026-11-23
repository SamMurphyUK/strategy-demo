/** Miss scars. A land miss leaves a small crater and drifting dirt. Navy and the air strike do not. */

import type { TheaterId } from "./combatTypes";

/** A miss on land leaves a scar. The naval board and the air-strike board do not. */
export function missLeavesCrater(theater: TheaterId): boolean {
  return theater !== "navy_test" && theater !== "air_strike_test";
}

/**
 * About half a light hit crater. A light hit runs about 9–14 wide and 6–9 tall.
 * `roll` returns 0–1, the same range as Math.random.
 */
export function missCraterRadii(roll: () => number = Math.random): { rx: number; ry: number } {
  return {
    rx: 5 + roll() * 2.5,
    ry: 3 + roll() * 1.5,
  };
}
