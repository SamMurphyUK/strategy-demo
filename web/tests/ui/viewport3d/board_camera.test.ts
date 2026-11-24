import { describe, expect, it } from "vitest";
import { MAX_ZOOM_FACTOR, MIN_ZOOM_FACTOR } from "../../../src/ui/map/viewMath";
import {
  BOARD_FOV_DEG,
  boardPose,
  cameraDistance,
  clampBoardK,
  clampCenter,
  fitBoardK,
  MAX_PITCH_DEG,
  pitchFor,
  TILT_FULL,
  TILT_START,
  toScene,
} from "../../../src/ui/viewport3d/boardCamera";

const BOARD = { x: 0, y: 0, w: 800, h: 504 };

describe("board camera", () => {
  it("puts a map point on the water plane with y flipped", () => {
    expect(toScene({ x: 12, y: 30 })).toEqual([12, -30, 0]);
  });

  it("fits the board inside the padded viewport", () => {
    // 1600x1040 minus 16px each side: 1568 / 800 = 1.96, 1008 / 504 = 2.
    expect(fitBoardK(BOARD, 1600, 1040)).toBeCloseTo(1.96, 6);
    expect(fitBoardK(BOARD, 1600, 600)).toBeCloseTo(568 / 504, 6);
  });

  it("keeps the zoom inside the 2D map's limits", () => {
    expect(clampBoardK(0.01, 2)).toBeCloseTo(2 * MIN_ZOOM_FACTOR, 9);
    expect(clampBoardK(1000, 2)).toBeCloseTo(2 * MAX_ZOOM_FACTOR, 9);
    expect(clampBoardK(3, 2)).toBe(3);
  });

  it("looks straight down until the zoom passes the tilt start", () => {
    expect(pitchFor(2, 2)).toBe(0);
    expect(pitchFor(2 * TILT_START, 2)).toBe(0);
  });

  it("reaches the full tip at the tilt end and holds it", () => {
    const full = (MAX_PITCH_DEG * Math.PI) / 180;
    expect(pitchFor(2 * TILT_FULL, 2)).toBeCloseTo(full, 9);
    expect(pitchFor(2 * TILT_FULL * 3, 2)).toBeCloseTo(full, 9);
  });

  it("tips further as the zoom grows", () => {
    let previous = -1;
    for (let zoom = TILT_START; zoom <= TILT_FULL; zoom += 0.2) {
      const pitch = pitchFor(zoom, 1);
      expect(pitch).toBeGreaterThanOrEqual(previous);
      previous = pitch;
    }
  });

  it("sets the distance so one world unit covers k pixels", () => {
    const height = 900;
    const k = 3;
    const distance = cameraDistance(k, height);
    const visibleWorld = 2 * distance * Math.tan((BOARD_FOV_DEG * Math.PI) / 360);
    expect(height / visibleWorld).toBeCloseTo(k, 9);
    expect(cameraDistance(k * 2, height)).toBeCloseTo(distance / 2, 9);
  });

  it("sits directly above the target when flat", () => {
    const pose = boardPose({ center: { x: 400, y: 252 }, k: 2 }, 2, 900);
    expect(pose.pitch).toBe(0);
    expect(pose.target).toEqual([400, -252, 0]);
    expect(pose.position[0]).toBe(400);
    expect(pose.position[1]).toBeCloseTo(-252, 9);
    expect(pose.position[2]).toBeCloseTo(pose.distance, 9);
  });

  it("backs off to the south and stays the same distance away when tipped", () => {
    const pose = boardPose({ center: { x: 400, y: 252 }, k: 2 * TILT_FULL }, 2, 900);
    expect(pose.pitch).toBeGreaterThan(0);
    // South on the map is larger y, which is smaller scene y.
    expect(pose.position[1]).toBeLessThan(pose.target[1]);
    expect(pose.position[2]).toBeGreaterThan(0);
    const dy = pose.position[1] - pose.target[1];
    const dz = pose.position[2] - pose.target[2];
    expect(Math.hypot(dy, dz)).toBeCloseTo(pose.distance, 9);
  });

  it("keeps the centre on the board", () => {
    expect(clampCenter({ x: -50, y: 900 }, BOARD)).toEqual({ x: 0, y: 504 });
    expect(clampCenter({ x: 300, y: 200 }, BOARD)).toEqual({ x: 300, y: 200 });
  });
});
