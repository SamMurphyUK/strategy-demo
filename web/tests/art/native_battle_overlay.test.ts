import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  attackerStation,
  battlePixel,
  battleUnitType,
  besideStation,
  boardPoint,
  COMPARE_ROW,
  downsampleBeatHalf,
  draggedStation,
  fieldBlit,
  fieldDampZoom,
  fieldGap,
  fieldRows,
  fieldScrollForZoom,
  fieldUnitScaleLabel,
  fieldViewSize,
  fieldWheelZoom,
  fieldZoomLabel,
  nativeBeatPixels,
  nativeStamp,
  opaqueFeet,
  snapDeviceOrigin,
  stampHolds,
  heldClipAt,
  MARCH_PIXELS_PER_SECOND,
  marchDistance,
  pictureLabel,
  vectorStandIn,
  walkFrameAt,
} from "../../src/art/nativeBattleOverlay";
import type { PlaybackBeat } from "../../src/art/motionPreview";
import { shipPlate, tankPlate, TANK_PAD, TANK_PARTS } from "./plateFixture";

const IDLE: PlaybackBeat = { name: "idle", pose: "idle", recoil: 0, flat: "idle" };

describe("native battle overlay", () => {
  it("stands a plate on the battle's attacker station at one plate pixel per battle pixel", () => {
    const doc = tankPlate();
    const vector = attackerStation("land", COMPARE_ROW);
    expect(vector).toEqual({ x: 102, y: 160 + COMPARE_ROW * 46 });
    expect(attackerStation("sea", 0)).toEqual({ x: 102, y: 565 });

    const station = besideStation(vector, doc.blueprint.canvasSize.width);
    const stamp = nativeStamp(doc.blueprint.canvasSize, doc.blueprint.groundOrigin, station);
    expect(stamp.scale).toBe(1);
    expect(stamp.width).toBe(doc.blueprint.canvasSize.width);
    expect(stamp.height).toBe(doc.blueprint.canvasSize.height);
    expect(stamp.width).toBeGreaterThan(80);

    const foot = battlePixel(stamp, doc.blueprint.groundOrigin);
    expect(foot).toEqual(station);
    const next = battlePixel(stamp, { x: doc.blueprint.groundOrigin.x + 1, y: doc.blueprint.groundOrigin.y });
    expect(next).toEqual({ x: foot.x + 1, y: foot.y });

    const covered = nativeStamp(doc.blueprint.canvasSize, doc.blueprint.groundOrigin, vector);
    expect(battlePixel(covered, doc.blueprint.groundOrigin)).toEqual(vector);

    const half = nativeStamp(doc.blueprint.canvasSize, doc.blueprint.groundOrigin, station, 0.5);
    expect(half.scale).toBe(0.5);
    expect(half.width).toBe(doc.blueprint.canvasSize.width * 0.5);
    expect(half.height).toBe(doc.blueprint.canvasSize.height * 0.5);
    expect(battlePixel(half, doc.blueprint.groundOrigin)).toEqual(station);
    expect(stampHolds(half, station)).toBe(true);
    expect(stampHolds(half, { x: half.x - 1, y: station.y })).toBe(false);
    expect(fieldUnitScaleLabel(1)).toBe("1× native");
    expect(fieldUnitScaleLabel(0.5)).toBe("1/2×");
    expect(fieldUnitScaleLabel(2)).toBe("2×");
    expect(boardPoint({ x: 200, y: 100 }, fieldViewSize(2))).toEqual({ x: 100, y: 50 });
    expect(draggedStation({ x: 10, y: 4 }, { x: 80, y: 50 })).toEqual({ x: 70, y: 46 });
    expect(draggedStation({ x: 0, y: 0 }, { x: -20, y: 900 })).toEqual({ x: 0, y: 720 });
  });

  it("files pictures onto the battle rows with a gap between them", () => {
    const row = fieldRows([
      { width: 80, height: 80, footX: 40, category: "land", gap: 30 },
      { width: 100, height: 60, footX: 50, category: "land", gap: 10 },
      { width: 40, height: 40, footX: 20, category: "air", gap: 12 },
      { width: 60, height: 30, footX: 30, category: "sea", gap: 8 },
    ]);
    expect(row[0]).toEqual({ x: 102 + 40, y: 160 + COMPARE_ROW * 46 });
    expect(row[1]).toEqual({ x: 102 + 80 + 30 + 50, y: 160 + COMPARE_ROW * 46 });
    expect(row[2]).toEqual({ x: 102 + 20, y: 160 });
    expect(row[3]).toEqual({ x: 102 + 30, y: 565 });
    expect(fieldGap(1)).toBeGreaterThanOrEqual(24);
    expect(fieldGap(1)).toBeLessThanOrEqual(80);
    expect(fieldGap(1)).toBe(fieldGap(1));
    expect(fieldViewSize(1)).toEqual({ width: 1280, height: 720 });
    expect(fieldViewSize(3)).toEqual({ width: 3840, height: 2160 });
    expect(fieldViewSize(1.5)).toEqual({ width: 1920, height: 1080 });
    expect(fieldViewSize(9)).toEqual({ width: 1280 * 8, height: 720 * 8 });
    expect(fieldViewSize(0.01)).toEqual({ width: 320, height: 180 });
    expect(fieldZoomLabel(1)).toBe("1× native");
    expect(fieldWheelZoom(1, 100)).toBeLessThan(1);
    expect(fieldWheelZoom(1, -100)).toBeGreaterThan(1);
    expect(fieldWheelZoom(8, -1000)).toBe(8);
    expect(fieldWheelZoom(0.25, 1000)).toBe(0.25);
    expect(fieldDampZoom(1, 2, 0)).toBe(1);
    expect(fieldScrollForZoom({ x: 640, y: 360 }, { x: 100, y: 40 }, 2)).toEqual({ left: 1180, top: 680 });
  });

  it("starts another row when the next picture would leave the board", () => {
    const row = fieldRows([
      { width: 1200, height: 40, footX: 600, category: "land", gap: 20 },
      { width: 80, height: 40, footX: 40, category: "land", gap: 10 },
    ]);
    expect(row[0]?.y).toBe(160 + COMPARE_ROW * 46);
    expect(row[1]).toEqual({ x: 102 + 40, y: (row[0]?.y ?? 0) + 46 });
  });

  it("drops a wrapped row far enough to clear a tall picture", () => {
    const row = fieldRows([
      { width: 1200, height: 40, footX: 10, category: "sea", gap: 8 },
      { width: 80, height: 90, footX: 40, category: "sea", gap: 8 },
    ]);
    expect(row[0]?.y).toBe(565);
    expect(row[1]?.y).toBe(565 + 90);
  });

  it("paints the beat at the plate's own size", () => {
    const doc = tankPlate();
    const pixels = nativeBeatPixels(doc, IDLE);
    expect(pixels.width).toBe(doc.blueprint.canvasSize.width);
    expect(pixels.height).toBe(doc.blueprint.canvasSize.height);

    const x = TANK_PARTS.hull.x + TANK_PAD;
    const y = TANK_PARTS.hull.y + TANK_PAD;
    expect(pixels.rgba[(y * pixels.width + x) * 4 + 3]).toBe(255);
    expect(pixels.rgba[3]).toBe(0);
  });

  it("asks the battle drawer for the same unit the plate is", () => {
    expect(battleUnitType("tank")).toBe("tank");
    expect(battleUnitType("tac_bomber")).toBe("tactical_bomber");
    expect(battleUnitType(shipPlate().blueprint.unitTypeId)).toBe("destroyer");
    const standing = vectorStandIn("tank", 1, false);
    expect(standing.type).toBe("tank");
    expect(standing.side).toBe("attacker");
    expect(standing.animRecoil).toBe(1);
    expect(standing.isMarching).toBe(false);
    expect(vectorStandIn("destroyer", 0, true).isMarching).toBe(true);
  });

  it("plays the walk, and the shot on the same ticks as a plate", () => {
    expect(walkFrameAt(0, 8, 1)).toEqual({ clip: "fire", index: 0, firing: true, label: "Firing" });
    const walking = walkFrameAt(4.2 / 11, 8, 1);
    expect(walking.clip).toBe("walk");
    expect(walking.firing).toBe(false);
    expect(walking.index).toBe(2);
    expect(walking.label).toBe("Walking 3");
    expect(walkFrameAt(0, 8, 0)).toMatchObject({ clip: "walk", index: 0 });
    const played: number[] = [];
    for (let step = 0; step < 18; step += 1) {
      const frame = walkFrameAt((step + 0.2) / 11, 8, 1);
      if (frame.clip === "walk") {
        played.push(frame.index);
      }
    }
    expect(played).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5]);
  });

  it("plays an idle or a shot on its own, then starts again", () => {
    expect(heldClipAt(0, 8, "idle")).toEqual({ clip: "idle", index: 0, firing: false, label: "Idle 1" });
    expect(heldClipAt(5.2 / 11, 8, "fire")).toMatchObject({ clip: "fire", index: 5, firing: true, label: "Firing 6" });
    expect(heldClipAt(8.2 / 11, 8, "idle").index).toBe(0);
    expect(marchDistance(0)).toBe(0);
    expect(marchDistance(-1)).toBe(0);
    expect(MARCH_PIXELS_PER_SECOND).toBeCloseTo((11 * 14 * 1.2) / 16);
    expect(marchDistance(16 / 11)).toBeCloseTo(14 * 1.2);
  });

  it("stands a still picture on the bottom of its ink", () => {
    const rgba = new Uint8ClampedArray(4 * 3 * 4);
    rgba[(2 * 4 + 1) * 4 + 3] = 255;
    rgba[(2 * 4 + 2) * 4 + 3] = 255;
    expect(opaqueFeet(rgba, 4, 3)).toEqual({ x: 2, y: 2 });
    expect(pictureLabel({ factionId: "JAP", unitTypeId: "fighter", seed: 1, grade: "outlined" })).toBe("JAP Fighter 1, outlines");
  });

  it("snaps a blit origin onto a whole device pixel", () => {
    expect(snapDeviceOrigin(10, 1, 1)).toBe(10);
    expect(snapDeviceOrigin(10.4, 2, 1)).toBe(10.5);
    expect(snapDeviceOrigin(3.2, 1, 0.5)).toBe(Math.round(3.2 * 0.5) / 0.5);
    const halfSize = fieldBlit({ width: 40, height: 20 }, { width: 80, height: 40 }, { x: 10, y: 8 }, { x: 100, y: 50 }, 0.5, 1, 1, true);
    expect(halfSize).toEqual({ x: 95, y: 46, width: 40, height: 20 });
    const full = nativeStamp({ width: 80, height: 40 }, { x: 10, y: 8 }, { x: 100, y: 50 }, 1);
    const viewed = fieldBlit({ width: 40, height: 20 }, { width: 80, height: 40 }, { x: 10, y: 8 }, { x: 100, y: 50 }, 1, 0.5, 1, true);
    expect(viewed.width).toBe(full.width);
    expect(viewed.height).toBe(full.height);
    expect(viewed.x).toBe(snapDeviceOrigin(full.x, 1, 0.5));
    expect(viewed.y).toBe(snapDeviceOrigin(full.y, 1, 0.5));
  });
});

class MemoryCanvas {
  width: number;
  height: number;
  data: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  getContext(): {
    getImageData: () => { data: Uint8ClampedArray; width: number; height: number };
    createImageData: (width: number, height: number) => { data: Uint8ClampedArray; width: number; height: number };
    putImageData: (image: { data: Uint8ClampedArray }) => void;
  } {
    const canvas = this;
    return {
      getImageData: () => ({ data: canvas.data, width: canvas.width, height: canvas.height }),
      createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
      putImageData: (image: { data: Uint8ClampedArray }) => {
        canvas.data.set(image.data);
      },
    };
  }
}

const SKIN: readonly [number, number, number, number] = [210, 170, 130, 255];
const EYE: readonly [number, number, number, number] = [16, 12, 10, 255];

function readPixel(canvas: MemoryCanvas, x: number, y: number): number[] {
  const i = (y * canvas.width + x) * 4;
  return [canvas.data[i] ?? 0, canvas.data[i + 1] ?? 0, canvas.data[i + 2] ?? 0, canvas.data[i + 3] ?? 0];
}

describe("downsampleBeatHalf", () => {
  beforeAll(() => {
    Object.assign(globalThis, { OffscreenCanvas: MemoryCanvas });
  });

  afterAll(() => {
    Reflect.deleteProperty(globalThis, "OffscreenCanvas");
  });

  it.each([
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
    [5, 4],
  ])("keeps a 1×2 dark eye on skin when the eye starts at (%i, %i)", (originX, originY) => {
    const canvas = new MemoryCanvas(6, 6);
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const eye = x === originX && (y === originY || y === originY + 1);
        const color = eye ? EYE : SKIN;
        canvas.data.set(color, (y * canvas.width + x) * 4);
      }
    }
    const half = downsampleBeatHalf(canvas as unknown as OffscreenCanvas) as unknown as MemoryCanvas;
    expect(half.width).toBe(3);
    expect(half.height).toBe(3);
    const blockX = Math.floor(originX / 2);
    const topY = Math.floor(originY / 2);
    const bottomY = Math.floor((originY + 1) / 2);
    expect(readPixel(half, blockX, topY)).toEqual([...EYE]);
    expect(readPixel(half, blockX, bottomY)).toEqual([...EYE]);
  });

  it("drops a block that has no opaque pixel", () => {
    const canvas = new MemoryCanvas(2, 2);
    canvas.data[3] = 40;
    const half = downsampleBeatHalf(canvas as unknown as OffscreenCanvas) as unknown as MemoryCanvas;
    expect(readPixel(half, 0, 0)).toEqual([0, 0, 0, 0]);
  });
});
