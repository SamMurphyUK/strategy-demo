import { describe, expect, it } from "vitest";
import {
  advanceVehicle,
  createPreviewClock,
  createVehicleAnim,
  dampRecoil,
  previewModes,
  RECOIL_DAMP,
  tickVehicle,
  vehicleOffsets,
  type PreviewClock,
  type VehicleAnim,
  type VehicleMode,
} from "../../src/art/vehicleMotion";

describe("vehicle preview motion", () => {
  it("holds a stopping lunge for one tick and does not bump on the tick that clears it", () => {
    const clock = createPreviewClock();
    const anim = createVehicleAnim("moving");
    const change = previewModes(clock, "idle", 0.125);
    advanceVehicle(anim, "idle", clock.allTime, change.changed, change.modes, () => 0);
    expect(anim.lunge).toBe(1);
    expect(anim.frame).toBe(0);
    expect(vehicleOffsets(anim).tracks).toEqual({ x: 0, y: 0 });
    expect(vehicleOffsets(anim).hull).toEqual({ x: 1, y: 1 });
    expect(vehicleOffsets(anim).turret).toEqual({ x: 1, y: 1 });

    const next = previewModes(clock, "idle", 0.125);
    advanceVehicle(anim, "idle", clock.allTime, next.changed, next.modes, () => 0);
    expect(anim.lunge).toBe(0);
    expect(anim.bumpTimer).toBe(0);
    expect(anim.frame).toBe(1);
    expect(vehicleOffsets(anim).hull).toEqual({ x: 0, y: 0 });
    expect(vehicleOffsets(anim).turret).toEqual({ x: 0, y: 0 });
  });

  it("lifts the hull, then the turret one tick later", () => {
    const moving = createVehicleAnim("moving");
    tickVehicle(moving, "moving", scripted([0.21, 0.49]));
    expect(moving.bumpTimer).toBe(2);
    expect(moving.bumpDir).toBe(-1);
    expect(vehicleOffsets(moving).hull.y).toBe(-1);
    expect(vehicleOffsets(moving).turret.y).toBe(0);

    tickVehicle(moving, "moving", () => {
      throw new Error("a bump in progress does not roll again");
    });
    expect(moving.bumpTimer).toBe(1);
    expect(vehicleOffsets(moving).hull.y).toBe(0);
    expect(vehicleOffsets(moving).turret.y).toBe(-1);

    tickVehicle(moving, "moving", () => {
      throw new Error("the tick that lands does not roll");
    });
    expect(moving.bumpTimer).toBe(0);
    expect(vehicleOffsets(moving).hull.y).toBe(0);
    expect(vehicleOffsets(moving).turret.y).toBe(0);

    const idle = createVehicleAnim("idle");
    tickVehicle(idle, "idle", scripted([0.04]));
    expect(idle.bumpDir).toBe(1);
    expect(idle.bumpTimer).toBe(2);
    expect(vehicleOffsets(idle).hull.y).toBe(1);
    expect(vehicleOffsets(idle).turret.y).toBe(0);
  });

  it("does not bump while firing, and kicks 2 to 4 pixels on the second fire tick", () => {
    const anim = createVehicleAnim("firing");
    tickVehicle(anim, "firing", scripted([0]));
    expect(anim.stateTick).toBe(1);
    expect(anim.recoilX).toBe(-2);
    expect(anim.bumpTimer).toBe(0);
    tickVehicle(anim, "firing", () => {
      throw new Error("the kick is only on the second fire tick");
    });
    expect(anim.stateTick).toBe(2);
    expect(anim.recoilX).toBe(-2);
    const hard = createVehicleAnim("firing");
    tickVehicle(hard, "firing", () => 1);
    expect(hard.recoilX).toBe(-4);

    const left = createVehicleAnim("firing", -1);
    tickVehicle(left, "firing", scripted([0]));
    expect(left.recoilX).toBe(2);

    for (let i = 0; i < 40; i += 1) {
      const sample = createVehicleAnim("firing");
      tickVehicle(sample, "firing");
      expect(sample.recoilX).toBeLessThanOrEqual(-2);
      expect(sample.recoilX).toBeGreaterThanOrEqual(-4);
    }
  });

  it("damps recoil every frame and snaps when it is under a tenth of a pixel", () => {
    const anim = createVehicleAnim("firing");
    anim.recoilX = -4;
    dampRecoil(anim, 1 / 60);
    expect(anim.recoilX).toBeCloseTo(-4 * RECOIL_DAMP);
    dampRecoil(anim, 1 / 30);
    expect(anim.recoilX).toBeCloseTo(-4 * RECOIL_DAMP * RECOIL_DAMP * RECOIL_DAMP);

    anim.recoilX = -0.11;
    dampRecoil(anim, 1 / 60);
    expect(anim.recoilX).toBe(0);
    dampRecoil(anim, 0);
    expect(anim.recoilX).toBe(0);
  });

  it("plays 10s moving, 4s idle, and 1s firing, then starts again", () => {
    const clock = createPreviewClock();
    clock.motion = "all";
    const anim = createVehicleAnim("moving");
    const opening = play(clock, anim, 80, () => 1);
    expect(opening[78]).toBe("moving");
    expect(opening[79]).toBe("idle");
    expect(clock.allTime).toBeCloseTo(10);
    expect(anim.mode).toBe("idle");
    expect(anim.lunge).toBe(1);
    expect(anim.frame).toBe(0);

    const idle = play(clock, anim, 32, () => 0);
    expect(idle[30]).toBe("idle");
    expect(idle[31]).toBe("firing");
    expect(clock.allTime).toBeCloseTo(14);
    expect(anim.mode).toBe("firing");
    expect(anim.stateTick).toBe(0);
    expect(anim.recoilX).toBe(0);

    const kick = play(clock, anim, 1, () => 0);
    expect(kick).toEqual(["firing"]);
    expect(anim.stateTick).toBe(1);
    expect(anim.recoilX).toBe(-2);
    expect(anim.frame).toBe(1);

    const rest = play(clock, anim, 7, () => 1);
    expect(rest.slice(0, 6).every((mode) => mode === "firing")).toBe(true);
    expect(rest[6]).toBe("moving");
    expect(clock.allTime).toBe(0);
    expect(anim.mode).toBe("moving");
    expect(anim.lunge).toBe(0);
  });

  it("drops a pending tick when the preview button changes", () => {
    const clock = createPreviewClock();
    clock.carry = 0.2;
    const step = previewModes(clock, "fire", 1);
    expect(step.changed).toBe(true);
    expect(step.modes).toEqual([]);
    expect(step.dt).toBe(0.25);
    expect(clock.carry).toBe(0);
    expect(clock.allTime).toBe(0);
    expect(clock.motion).toBe("fire");
  });
});

function play(clock: PreviewClock, anim: VehicleAnim, ticks: number, random: () => number): VehicleMode[] {
  const modes: VehicleMode[] = [];
  for (let i = 0; i < ticks; i += 1) {
    const step = previewModes(clock, "all", 0.125);
    expect(step.changed).toBe(false);
    expect(step.modes).toHaveLength(1);
    const mode = step.modes[0];
    if (!mode) {
      continue;
    }
    modes.push(mode);
    advanceVehicle(anim, "all", clock.allTime, false, step.modes, random);
  }
  return modes;
}

function scripted(values: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index] ?? 0;
    index += 1;
    return value;
  };
}
