import { describe, expect, it } from "vitest";
import { BATTLE_DAY_PACE, BATTLE_DAY_START, skyAt, skyModeFor } from "../../../src/ui/viewport3d/battle/battleSky";
import { COLUMN_GAP, columnX } from "../../../src/ui/viewport3d/battle/battleLanes";

describe("battle sky", () => {
  it("picks night only when asked", () => {
    expect(skyModeFor("normandy", null)).toBe("day");
    expect(skyModeFor("normandy", "night")).toBe("night");
  });

  it("keeps a lit, shadowed sun through a long battle, never a shadowless sunset", () => {
    for (let t = 0; t <= 300; t += 15) {
      const s = skyAt("day", t);
      expect(s.direct).toBeGreaterThan(0.3);
      expect(s.shadow).toBeGreaterThan(0.1);
      expect(s.dir[2]).toBeGreaterThan(0.2);
      expect(s.night).toBe(0);
    }
    // The battle's clock stays inside the campaign's lit part of the day.
    expect(BATTLE_DAY_START + 300 * BATTLE_DAY_PACE).toBeLessThan(300 * 0.92);
  });

  it("is a cool, darker moonlit grade at night with a shadow", () => {
    const n = skyAt("night", 10);
    const d = skyAt("day", 10);
    expect(n.night).toBe(1);
    expect(n.shadow).toBeGreaterThan(0);
    expect(n.light[2]).toBeGreaterThan(n.light[0]);
    expect(n.light[0]).toBeLessThan(d.light[0] * 0.6);
  });

  it("lights surfaces near 1 by day and never past 1.1", () => {
    const l = skyAt("day", 40).light;
    for (const c of l) {
      expect(c).toBeGreaterThan(0.6);
      expect(c).toBeLessThanOrEqual(1.1);
    }
  });
});

describe("rank column x", () => {
  it("puts the four columns of a side one gap apart, with the corridor between the rank I columns about a third of the width", () => {
    expect(columnX("attacker", 3) - columnX("attacker", 2)).toBeCloseTo(COLUMN_GAP, 6);
    const corridor = columnX("defender", 0) - columnX("attacker", 3);
    expect(corridor / 18).toBeGreaterThan(0.3);
    expect(corridor / 18).toBeLessThan(0.4);
    expect(columnX("attacker", 0)).toBeCloseTo(-columnX("defender", 3), 1);
  });
});
