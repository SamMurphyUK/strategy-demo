import { describe, expect, it } from "vitest";
import { infantryIdlePhase, stepQuickFrame } from "../../src/art/quickUnitDraw";

const draw = (key: string, mode: "idle" | "moving", time: number) =>
  stepQuickFrame({
    key,
    factionId: "JAP",
    unitTypeId: "infantry",
    mode,
    face: 1,
    time,
    pixelScale: 1,
    feetX: 0,
    feetY: 0,
  });

describe("infantry idle phase", () => {
  it("keeps a soldier on one point in the idle and spreads a group", () => {
    expect(infantryIdlePhase("battle:a", 7)).toBe(infantryIdlePhase("battle:a", 7));
    expect(infantryIdlePhase("battle:a", 7)).toBeGreaterThanOrEqual(0);
    expect(infantryIdlePhase("battle:a", 7)).toBeLessThan(7);
    expect(infantryIdlePhase("battle:a", 1)).toBe(0);

    const phases = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => infantryIdlePhase(id, 7)));
    expect(phases.size).toBeGreaterThan(1);
  });

  it("offsets idle frames and leaves the march on one clock", () => {
    const left = draw("phase-left", "idle", 0);
    const right = draw("phase-right", "idle", 0);
    expect(left?.index).not.toBe(right?.index);

    const leftNext = draw("phase-left", "idle", 0.65);
    const rightNext = draw("phase-right", "idle", 0.65);
    expect(leftNext?.index).toBe(((left?.index ?? 0) + 1) % 7);
    expect(rightNext?.index).toBe(((right?.index ?? 0) + 1) % 7);
    expect(leftNext?.index).not.toBe(rightNext?.index);

    const marchA = draw("march-a", "moving", 0);
    const marchB = draw("march-b", "moving", 0);
    expect(marchA?.index).toBe(marchB?.index);
  });
});
