// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROUNDEL_IDS } from "../../../src/components/ui/RoundelBadge";
import type { RegionShape } from "../../../src/ui/map/geometry";
import { NO_EDIT } from "../../../src/ui/viewport3d/placements";
import { plinthRadius } from "../../../src/ui/viewport3d/plinthPlacement";
import { roundelGeometry } from "../../../src/ui/viewport3d/roundelMeshes";
import {
  hasRoundel,
  placeRoundels,
  ROUNDEL_REF,
  ROUNDEL_SHARE,
  roundelBuffer,
  roundelKey,
  roundelRadius,
  writeRoundels,
} from "../../../src/ui/viewport3d/roundelPlacement";

const region = (id: string, type: "land" | "sea", ipc: number, x = 10, y = 20): RegionShape => ({ id, type, ipc, anchor: { x, y } }) as RegionShape;

describe("which territories carry a roundel", () => {
  it("is land with an IPC value, and nothing else", () => {
    expect(hasRoundel(region("a", "land", 3))).toBe(true);
    expect(hasRoundel(region("b", "land", 0))).toBe(false);
    expect(hasRoundel(region("c", "sea", 4))).toBe(false);
  });

  it("wears the owner's roundel, at the anchor, keyed for the placement editor", () => {
    const regions = [region("moscow", "land", 8, 100, 50), region("desert", "land", 0), region("sea_1", "sea", 0), region("berlin", "land", 10)];
    const owners: Record<string, string> = { moscow: "ussr", berlin: "germany" };
    const placed = placeRoundels(regions, (id) => owners[id], {});
    expect(placed.map((item) => item.regionId)).toEqual(["moscow", "berlin"]);
    expect(placed.map((item) => item.roundel)).toEqual(["ussr", "ger"]);
    expect(placed[0].key).toBe(roundelKey("moscow"));
    expect(placed[0].instance).toMatchObject({ x: 100, y: 50, scale: ROUNDEL_REF });
  });

  it("follows an owner change and an edit", () => {
    const regions = [region("paris", "land", 2, 5, 5)];
    const edit = { ...NO_EDIT, dx: 3, mult: 2, dturn: 0.5 };
    const placed = placeRoundels(regions, () => undefined, { [roundelKey("paris")]: edit });
    expect(placed[0].roundel).toBe("neutral_true");
    expect(placed[0].instance).toMatchObject({ x: 8, y: 5, scale: ROUNDEL_REF * 2, turn: 0.5 });
  });
});

describe("how big a roundel is", () => {
  it("is just under an infantry base, and an edit scales it", () => {
    const base = plinthRadius(40, 4, 1, { pair: 1, crowd: 1, vehicleRadius: 1 }, "infantry");
    const radius = roundelRadius(40, 4, ROUNDEL_SHARE, ROUNDEL_REF);
    expect(radius).toBeLessThan(base);
    expect(radius).toBeCloseTo(base * ROUNDEL_SHARE, 6);
    expect(roundelRadius(40, 4, ROUNDEL_SHARE, ROUNDEL_REF * 1.5)).toBeCloseTo(radius * 1.5, 6);
  });

  it("is written into the buffer of its art, flat and thin", () => {
    const regions = [region("a", "land", 1, 7, 9), region("b", "land", 2), region("c", "land", 3)];
    const owners: Record<string, string> = { a: "ussr", b: "ussr", c: "japan" };
    const placed = placeRoundels(regions, (id) => owners[id], {});
    const buffers = new Map(ROUNDEL_IDS.map((id) => [id, roundelBuffer(8)] as const));
    writeRoundels(buffers, placed, { view: { x: 0, y: 0, k: 4 }, tokenPx: 40 }, { heightRatio: 0.05, share: ROUNDEL_SHARE }, () => ({ dome: 0, ridge: 0 }));
    expect(buffers.get("ussr")?.count).toBe(2);
    expect(buffers.get("jap")?.count).toBe(1);
    expect(buffers.get("us")?.count).toBe(0);
    const m = buffers.get("ussr")!.matrices;
    expect(m[12]).toBe(7);
    expect(m[13]).toBe(-9);
    expect(m[10]).toBeCloseTo(m[0] * 0.05, 6);
  });
});

describe("the roundel discs", () => {
  const dir = path.resolve(__dirname, "../../../public/assets/roundels");

  it.each([...ROUNDEL_IDS])("%s builds into a thin disc inside its own radius", (id) => {
    const geometry = roundelGeometry(readFileSync(path.join(dir, `${id}.svg`), "utf8"));
    const position = geometry.getAttribute("position");
    expect(position.count).toBeGreaterThan(100);
    expect(geometry.getAttribute("color")).toBeDefined();
    expect(geometry.getAttribute("aPart")).toBeDefined();
    let reach = 0;
    let top = -Infinity;
    for (let i = 0; i < position.count; i++) {
      reach = Math.max(reach, Math.hypot(position.getX(i), position.getY(i)));
      top = Math.max(top, position.getZ(i));
    }
    expect(reach).toBeLessThanOrEqual(1.001);
    // Thin: the art stacks to under three heights of the disc, and never below the ground.
    expect(top).toBeGreaterThan(1);
    expect(top).toBeLessThan(3);
    // The faces point up: the flat layers of the art face the sky, and none faces the ground (a stray zero-area triangle has no normal).
    const normal = geometry.getAttribute("normal");
    let layered = 0;
    let facingUp = 0;
    for (let i = 0; i < position.count; i++) {
      if (position.getZ(i) > 1.05) {
        layered += 1;
        expect(normal.getZ(i)).toBeGreaterThan(-0.5);
        if (normal.getZ(i) > 0.9) facingUp += 1;
      }
    }
    expect(facingUp / layered).toBeGreaterThan(0.97);
  });
});
