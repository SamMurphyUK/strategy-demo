import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { fitView, maxZoomK, MIN_ZOOM_FACTOR, projectionScales, worldToScreen } from "../../../src/ui/map/viewMath";
import {
  boardPose,
  boardView,
  cameraOf,
  clampBoardK,
  fitBoardK,
  holdCenter,
  pitchFor,
  projectScenePoint,
  SEA_DROP,
  seaShift,
  toScene,
} from "../../../src/ui/viewport3d/boardCamera";

const BOARD = { x: 0, y: 0, w: 800, h: 504 };
const WIDTH = 1280;
const HEIGHT = 720;

/** The Three.js camera the scene builds from a pose, so the test projects with the real matrices. */
function threeCamera(center: { x: number; y: number }, k: number): THREE.OrthographicCamera {
  const pose = boardPose({ center, k }, WIDTH, HEIGHT);
  const camera = new THREE.OrthographicCamera(-pose.halfWidth, pose.halfWidth, pose.halfHeight, -pose.halfHeight, 1, 4000);
  camera.position.set(...pose.position);
  camera.up.set(0, 1, 0);
  camera.lookAt(...pose.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

function toPixels(camera: THREE.OrthographicCamera, point: [number, number, number]): { x: number; y: number } {
  const ndc = new THREE.Vector3(...point).project(camera);
  return { x: ((ndc.x + 1) / 2) * WIDTH, y: ((1 - ndc.y) / 2) * HEIGHT };
}

describe("board camera", () => {
  it("puts a map point on the land plane with y flipped", () => {
    expect(toScene({ x: 12, y: 30 })).toEqual([12, -30, 0]);
  });

  it("fits the board the way the 2D map does", () => {
    expect(fitBoardK(BOARD, 1600, 1040)).toBe(fitView(BOARD, 1600, 1040).k);
    expect(fitBoardK(BOARD, 1600, 600)).toBeCloseTo(568 / 504, 6);
  });

  it("keeps the zoom inside the 2D map's limits", () => {
    expect(clampBoardK(0.01, 2)).toBeCloseTo(2 * MIN_ZOOM_FACTOR, 9);
    expect(clampBoardK(1000, 2)).toBe(maxZoomK(2, 1));
    expect(clampBoardK(1000, 2, 2)).toBe(maxZoomK(2, 2));
    expect(clampBoardK(3, 2)).toBe(3);
  });

  it("looks straight down while the 2D map is flat, and tips by its foreshortening after", () => {
    expect(pitchFor(1)).toBe(0);
    const { sx, sy } = projectionScales(4);
    expect(Math.cos(pitchFor(4))).toBeCloseTo(sy / sx, 12);
    expect(pitchFor(4)).toBeGreaterThan(pitchFor(1.6));
    expect(pitchFor(9)).toBeCloseTo(pitchFor(4), 12);
  });

  it("lands every land-plane point on the pixel the 2D view gives it", () => {
    for (const k of [0.9, 1.5, 2.2, 4, 7.5]) {
      const camera = { center: { x: 311.5, y: 207.25 }, k };
      const view = boardView(camera, WIDTH, HEIGHT);
      const three = threeCamera(camera.center, k);
      for (const p of [
        { x: 311.5, y: 207.25 },
        { x: 250, y: 180 },
        { x: 402.3, y: 260.9 },
      ]) {
        const flat = worldToScreen(view, p);
        const pure = projectScenePoint(camera, WIDTH, HEIGHT, toScene(p));
        const real = toPixels(three, toScene(p));
        expect(pure.x).toBeCloseTo(flat.x, 6);
        expect(pure.y).toBeCloseTo(flat.y, 6);
        expect(real.x).toBeCloseTo(flat.x, 4);
        expect(real.y).toBeCloseTo(flat.y, 4);
      }
    }
  });

  it("round-trips a 2D view through the camera", () => {
    const view = { x: 120.5, y: 64.25, k: 3.1 };
    const back = boardView(cameraOf(view, WIDTH, HEIGHT), WIDTH, HEIGHT);
    expect(back.x).toBeCloseTo(view.x, 9);
    expect(back.y).toBeCloseTo(view.y, 9);
    expect(back.k).toBe(view.k);
  });

  it("slides the sea so its sheet registers with the land's", () => {
    // A point of the sea's picture, drawn one drop down and one shift north, covers the same pixel
    // as that map point on the land plane.
    for (const k of [1, 2, 4.4]) {
      const camera = { center: { x: 400, y: 252 }, k };
      const three = threeCamera(camera.center, k);
      const p = { x: 380, y: 300 };
      const onLand = toPixels(three, toScene(p));
      const onSea = toPixels(three, [p.x, -p.y + seaShift(k), -SEA_DROP]);
      expect(onSea.x).toBeCloseTo(onLand.x, 4);
      expect(onSea.y).toBeCloseTo(onLand.y, 4);
    }
    expect(seaShift(1)).toBe(0);
    expect(seaShift(4)).toBeCloseTo(SEA_DROP * Math.tan(pitchFor(4)), 12);
  });

  it("shows the cliff below a south coast once the board tips", () => {
    const three = threeCamera({ x: 400, y: 252 }, 4);
    const lip = toPixels(three, [400, -252, 0]);
    const foot = toPixels(three, [400, -252, -SEA_DROP]);
    expect(foot.x).toBeCloseTo(lip.x, 6);
    expect(foot.y - lip.y).toBeCloseTo(SEA_DROP * Math.sin(pitchFor(4)) * 4, 4);
  });

  it("backs off to the south and frames one world unit as k pixels", () => {
    const pose = boardPose({ center: { x: 400, y: 252 }, k: 4 }, WIDTH, HEIGHT);
    expect(pose.target).toEqual([400, -252, 0]);
    // South on the map is larger y, which is smaller scene y.
    expect(pose.position[1]).toBeLessThan(pose.target[1]);
    expect(pose.position[2]).toBeGreaterThan(0);
    expect(pose.halfWidth * 2 * 4).toBeCloseTo(WIDTH, 9);
    expect(pose.halfHeight * 2 * 4).toBeCloseTo(HEIGHT, 9);
    const flat = boardPose({ center: { x: 400, y: 252 }, k: 1 }, WIDTH, HEIGHT);
    expect(flat.pitch).toBe(0);
    expect(flat.position[0]).toBe(400);
    expect(flat.position[1]).toBeCloseTo(-252, 9);
  });

  it("holds the centre on the board, folding x on a wrapped world", () => {
    expect(holdCenter({ x: -50, y: 900 }, BOARD, false)).toEqual({ x: 0, y: 504 });
    expect(holdCenter({ x: -50, y: 900 }, BOARD, true)).toEqual({ x: 750, y: 504 });
    expect(holdCenter({ x: 300, y: 200 }, BOARD, true)).toEqual({ x: 300, y: 200 });
  });
});
