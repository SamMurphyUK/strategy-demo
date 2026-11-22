import { describe, expect, it } from "vitest";
import {
  averagePoint,
  baseScaleForLiveCount,
  desiredCinematicView,
  identityCam,
  lerpCam,
  pruneCinematicHits,
  screenToWorld,
  zoomCamAt,
  zoomCamField,
} from "../../../src/ui/battle/battleCinematic";

describe("battle cinematic camera", () => {
  it("zooms closer when few units remain", () => {
    expect(baseScaleForLiveCount(3)).toBeGreaterThan(baseScaleForLiveCount(10));
    expect(baseScaleForLiveCount(10)).toBeGreaterThan(baseScaleForLiveCount(20));
  });

  it("focuses the dice while rolling, then the firing row and the hits", () => {
    const shooters = [{ x: 200, y: 300 }];
    const track = [{ x: 700, y: 320 }];
    const hits = [{ x: 900, y: 340 }];

    const rolling = desiredCinematicView({
      canvasW: 1280,
      canvasH: 720,
      liveCount: 12,
      subPhase: "ROLLING",
      shooterPoints: shooters,
      trackPoints: [],
      hitPoints: [],
      allocation: false,
    });
    expect(rolling.focusY).toBeGreaterThan(500);
    expect(rolling.scale).toBeGreaterThan(1.2);

    const onShooters = desiredCinematicView({
      canvasW: 1280,
      canvasH: 720,
      liveCount: 12,
      subPhase: "FIRING",
      shooterPoints: shooters,
      trackPoints: [],
      hitPoints: [],
      allocation: false,
    });
    expect(onShooters.focusX).toBeCloseTo(200);
    expect(onShooters.scale).toBeGreaterThan(1.3);

    const onTrack = desiredCinematicView({
      canvasW: 1280,
      canvasH: 720,
      liveCount: 12,
      subPhase: "FIRING",
      shooterPoints: shooters,
      trackPoints: track,
      hitPoints: [],
      allocation: false,
    });
    expect(onTrack.focusX).toBeGreaterThan(200);
    expect(onTrack.focusX).toBeLessThan(700);

    const onHits = desiredCinematicView({
      canvasW: 1280,
      canvasH: 720,
      liveCount: 12,
      subPhase: "FIRING",
      shooterPoints: [],
      trackPoints: [],
      hitPoints: hits,
      allocation: false,
    });
    expect(onHits.focusX).toBeCloseTo(900);
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
    expect(pruneCinematicHits([{ x: 1, y: 2, until: 5 }, { x: 3, y: 4, until: 1 }], 2)).toEqual([
      { x: 1, y: 2, until: 5 },
    ]);
  });
});
