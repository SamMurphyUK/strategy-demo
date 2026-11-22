import { describe, expect, it } from "vitest";
import {
  averagePoint,
  baseScaleForLiveCount,
  desiredCinematicView,
  identityCam,
  lerpCam,
  pruneCinematicHits,
  screenToWorld,
  panCam,
  zoomCamAt,
  zoomCamField,
} from "../../../src/ui/battle/battleCinematic";

describe("battle cinematic camera", () => {
  it("zooms closer when few units remain", () => {
    expect(baseScaleForLiveCount(3)).toBeGreaterThan(baseScaleForLiveCount(10));
    expect(baseScaleForLiveCount(10)).toBeGreaterThan(baseScaleForLiveCount(20));
  });

  it("holds on the units, and pans toward a mover with only a slight zoom", () => {
    const units = [
      { x: 180, y: 280 },
      { x: 900, y: 320 },
    ];
    const held = desiredCinematicView({
      canvasW: 1280,
      canvasH: 720,
      unitPoints: units,
      motionPoints: [],
    });
    expect(held.focusX).toBeCloseTo(540);
    expect(held.focusY).toBeCloseTo(300);
    expect(held.scale).toBeLessThan(1.2);

    const following = desiredCinematicView({
      canvasW: 1280,
      canvasH: 720,
      unitPoints: units,
      motionPoints: [{ x: 900, y: 320 }],
    });
    expect(following.focusX).toBeGreaterThan(held.focusX);
    expect(following.focusX).toBeLessThan(900);
    expect(following.scale - held.scale).toBeGreaterThan(0);
    expect(following.scale - held.scale).toBeLessThan(0.15);

    const empty = desiredCinematicView({
      canvasW: 1280,
      canvasH: 720,
      unitPoints: [],
      motionPoints: [{ x: 640, y: 600 }],
    });
    expect(empty.focusX).toBeCloseTo(640);
    expect(empty.focusY).toBeCloseTo(360);
  });

  it("keeps the board point under the cursor when zooming", () => {
    const cam = identityCam(1280, 720);
    const next = zoomCamAt(cam, 400, 200, 1280, 720, -100);
    expect(next.scale).toBeGreaterThan(cam.scale);
    const before = screenToWorld(400, 200, cam, 1280, 720);
    const after = screenToWorld(400, 200, next, 1280, 720);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it("will not zoom out past the starting frame", () => {
    const cam = identityCam(1280, 720);
    const held = zoomCamField(cam, 400, 200, 1280, 720, 800, 0);
    expect(held.scale).toBe(1);
    expect(held.focusX).toBeCloseTo(cam.focusX, 4);
    expect(held.focusY).toBeCloseTo(cam.focusY, 4);
    const closer = zoomCamField({ scale: 3, focusX: 640, focusY: 360 }, 200, 100, 1280, 720, 900, 0);
    expect(closer.scale).toBeGreaterThanOrEqual(1);
    expect(closer.scale).toBeLessThan(3);
  });

  it("drags the zoomed board and stops at its edge", () => {
    const cam = { scale: 2, focusX: 640, focusY: 360 };
    const shifted = panCam(cam, -200, 0, 1280, 720);
    expect(shifted.focusX).toBeCloseTo(740, 4);
    expect(shifted.focusY).toBeCloseTo(360, 4);
    const past = panCam(cam, 2000, 2000, 1280, 720);
    expect(past.focusX).toBeCloseTo(1280 / 4, 4);
    expect(past.focusY).toBeCloseTo(720 / 4, 4);
    const held = panCam(identityCam(1280, 720), 400, 80, 1280, 720);
    expect(held.focusX).toBeCloseTo(640, 4);
    expect(held.focusY).toBeCloseTo(360, 4);
  });

  it("zooms past the cinematic framing, the way the field test does, and keeps the point", () => {
    const cam = { scale: 2.2, focusX: 640, focusY: 360 };
    const next = zoomCamField(cam, 400, 200, 1280, 720, -400, 0);
    expect(next.scale).toBeGreaterThan(2.4);
    const before = screenToWorld(400, 200, cam, 1280, 720);
    const after = screenToWorld(400, 200, next, 1280, 720);
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
  });

  it("averages points, lerps, and drops expired hit marks", () => {
    expect(averagePoint([])).toBeNull();
    expect(averagePoint([{ x: 0, y: 0 }, { x: 10, y: 20 }])).toEqual({ x: 5, y: 10 });
    const a = identityCam(100, 100);
    const b = { scale: 2, focusX: 50, focusY: 50 };
    const mid = lerpCam(a, b, 1 / 60);
    expect(mid.scale).toBeGreaterThan(1);
    expect(mid.scale).toBeLessThan(2);
    const eased = lerpCam(a, { scale: 1.2, focusX: 20, focusY: 20 }, 1 / 30, 1.05, 0.32);
    const panShare = (a.focusX - eased.focusX) / (a.focusX - 20);
    const zoomShare = (eased.scale - a.scale) / 0.2;
    expect(panShare).toBeGreaterThan(zoomShare);
    expect(pruneCinematicHits([{ x: 1, y: 2, until: 5 }, { x: 3, y: 4, until: 1 }], 2)).toEqual([
      { x: 1, y: 2, until: 5 },
    ]);
  });
});
