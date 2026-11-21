import { describe, expect, it } from "vitest";
import { resolveQuickClip } from "../../src/art/quickUnitCatalog";
import { quickAnchor, quickFxRects, quickMuzzleBloom, type QuickFxMarks } from "../../src/art/quickUnitFx";

describe("quick unit muzzle and exhaust", () => {
  it("keeps each tank's smoke mark and a barrel tip", () => {
    expect(resolveQuickClip("GER", "tank")?.fx).toMatchObject({
      smoke: { x: 16, y: 40 },
      muzzle: { x: 191, y: 26 },
      flashFrames: [1],
      puffFrames: { idle: [6, 7], fire: [5, 6, 7] },
    });
    expect(resolveQuickClip("USSR", "tank")?.fx.muzzle).toEqual({ x: 187, y: 26 });
    expect(resolveQuickClip("USSR", "tank")?.fx.smoke).toEqual({ x: 15, y: 48 });
    expect(resolveQuickClip("UK", "tank")?.fx.muzzle).toEqual({ x: 168, y: 39 });
    expect(resolveQuickClip("UK", "tank")?.fx.smoke).toEqual({ x: 11, y: 56 });
    expect(resolveQuickClip("US", "tank")?.fx.muzzle).toEqual({ x: 138, y: 40 });
    expect(resolveQuickClip("US", "tank")?.fx.smoke).toEqual({ x: 6, y: 58 });
    expect(resolveQuickClip("JAP", "tank")?.fx.muzzle).toEqual({ x: 172, y: 28 });
    expect(resolveQuickClip("JAP", "tank")?.fx.smoke).toEqual({ x: 5, y: 55 });
    expect(resolveQuickClip("GER", "infantry")).toBeNull();
  });

  it("draws the muzzle flash in front of the barrel on the shot frame", () => {
    const clip = resolveQuickClip("GER", "tank");
    expect(clip?.fx.muzzle).toEqual({ x: 191, y: 26 });
    if (!clip?.fx.muzzle) {
      return;
    }
    const shot = quickFxRects(clip.fx, clip.feet, "fire", 1, 1);
    const flashes = shot.filter((rect) => rect.kind === "muzzle");
    const anchor = quickAnchor(clip.fx.muzzle, clip.feet, 1);
    expect(flashes.length).toBeGreaterThan(0);
    expect(flashes.every((rect) => rect.x > anchor.x)).toBe(true);
    expect(quickFxRects(clip.fx, clip.feet, "fire", 0, 1).some((rect) => rect.kind === "muzzle")).toBe(false);
    expect(quickFxRects(clip.fx, clip.feet, "idle", 1, 1).some((rect) => rect.kind === "muzzle")).toBe(false);

    const onlyFirst: QuickFxMarks = { ...clip.fx, flashFrames: [0] };
    expect(quickFxRects(onlyFirst, clip.feet, "fire", 0, 1).some((rect) => rect.kind === "muzzle")).toBe(true);
    expect(quickFxRects(onlyFirst, clip.feet, "fire", 1, 1).some((rect) => rect.kind === "muzzle")).toBe(false);

    const unmarked: QuickFxMarks = { ...clip.fx, flashFrames: [], muzzle: null };
    expect(quickFxRects(unmarked, clip.feet, "fire", 1, 1).some((rect) => rect.kind === "muzzle")).toBe(false);

    const us = resolveQuickClip("US", "tank");
    expect(us).not.toBeNull();
    if (us) {
      expect(quickFxRects(us.fx, us.feet, "fire", 1, 1).some((rect) => rect.kind === "muzzle")).toBe(true);
    }
  });

  it("lifts exhaust on puff frames and whenever the hull is hurt", () => {
    const clip = resolveQuickClip("GER", "tank");
    expect(clip?.fx.smoke).not.toBeNull();
    if (!clip?.fx.smoke) {
      return;
    }
    expect(quickFxRects(clip.fx, clip.feet, "idle", 0, 1)).toEqual([]);
    // Walk always vents a light exhaust cycle when the clip has a smoke mark.
    expect(quickFxRects(clip.fx, clip.feet, "walk", 6, 1).some((rect) => rect.kind === "smoke")).toBe(true);
    expect(quickFxRects(clip.fx, clip.feet, "walk", 0, 1).some((rect) => rect.kind === "smoke")).toBe(true);

    const puff = quickFxRects(clip.fx, clip.feet, "idle", 6, 1);
    const anchor = quickAnchor(clip.fx.smoke, clip.feet, 1);
    expect(puff.length).toBeGreaterThan(0);
    expect(puff.every((rect) => rect.kind === "smoke" && rect.y < anchor.y)).toBe(true);

    const rising = quickFxRects(clip.fx, clip.feet, "fire", 7, 1);
    expect(Math.min(...rising.map((rect) => rect.y))).toBeLessThan(Math.min(...puff.map((rect) => rect.y)));

    const hurt = quickFxRects(clip.fx, clip.feet, "idle", 0, 1, { damaged: true });
    expect(hurt.some((rect) => rect.kind === "smoke")).toBe(true);
    expect(Math.min(...hurt.map((rect) => rect.y))).toBeLessThan(anchor.y - 7);
    expect(quickFxRects(clip.fx, clip.feet, "walk", 0, 1, { damaged: true }).some((rect) => rect.kind === "smoke")).toBe(true);

    const quiet: QuickFxMarks = { ...clip.fx, smoke: null };
    expect(quickFxRects(quiet, clip.feet, "idle", 6, 1, { damaged: true })).toEqual([]);
  });

  it("keeps a readable rise when the sprite is drawn smaller than its art", () => {
    const clip = resolveQuickClip("GER", "tank");
    if (!clip?.fx.smoke) {
      return;
    }
    const small = quickFxRects(clip.fx, clip.feet, "idle", 6, 0.25);
    const anchor = quickAnchor(clip.fx.smoke, clip.feet, 0.25);
    const rise = anchor.y - Math.min(...small.map((rect) => rect.y));
    expect(rise).toBeGreaterThan(1);
  });

  it("scales the battle bloom with the drawn sprite", () => {
    expect(quickMuzzleBloom(192, 48 / 192, 1)).toEqual({ radius: 18, core: 4 });
    expect(quickMuzzleBloom(192, 48 / 192, 0.25)).toBeNull();
    expect(quickMuzzleBloom(192, 0, 1)).toBeNull();
  });
});
