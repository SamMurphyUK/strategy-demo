import { describe, expect, it } from "vitest";
import { fieldContactLocal, fieldPicture } from "../../src/art/fieldUnitPicture";
import { resolveQuickClip, type QuickClipRef } from "../../src/art/quickUnitCatalog";
import { QUIET_QUICK_FX } from "../../src/art/quickUnitFx";
import { BATTLE_UNIT_BOOST, laneScale, SHORE_Y, VANISH } from "../../src/ui/battle/scenery/perspective";
import type { VehicleOffsets } from "../../src/art/vehicleMotion";

const STILL: VehicleOffsets = {
  root: { x: 0, y: 0 },
  tracks: { x: 0, y: 0 },
  torso: { x: 0, y: 0 },
  head: { x: 0, y: 0 },
  weapon: { x: 0, y: 0 },
  hull: { x: 0, y: 0 },
  turret: { x: 0, y: 0 },
};

describe("field unit picture", () => {
  it("sizes a tank to the lane, without the battle's extra boost", () => {
    const clip = resolveQuickClip("GER", "tank");
    expect(clip).toBeTruthy();
    if (!clip) return;
    const picture = fieldPicture({
      id: "tank",
      clip,
      href: "/tank.svg",
      offsets: { ...STILL, root: { x: 3, y: -1 } },
      mode: "idle",
      frame: 0,
      x: 120,
      y: SHORE_Y,
      laneY: SHORE_Y,
      crisp: true,
      time: 0,
    });
    expect(picture.unitScale).toBeCloseTo(laneScale(SHORE_Y), 6);
    expect(picture.unitScale * BATTLE_UNIT_BOOST).not.toBeCloseTo(picture.unitScale, 6);
    expect(picture.figure?.parts).toHaveLength(1);
    expect(picture.figure?.parts[0]?.href).toBe("/tank.svg");
    expect(picture.figure?.rootX).toBe(-clip.feet.x + 3);
    expect(picture.figure?.rootY).toBe(-clip.feet.y - 1);
    expect(picture.figure?.unitScale).toBe(picture.unitScale);
    expect(picture.unitScale).toBeGreaterThan(fieldPicture({ ...blank(clip), laneY: VANISH.y, y: VANISH.y }).unitScale);
  });

  it("leaves the figure empty when crisp pictures is off", () => {
    const clip = resolveQuickClip("US", "fighter");
    expect(clip?.file).toBeTruthy();
    if (!clip) return;
    const picture = fieldPicture({
      id: "still",
      clip,
      href: clip.file ?? "",
      offsets: STILL,
      mode: "idle",
      frame: 0,
      x: 0,
      y: SHORE_Y,
      laneY: SHORE_Y,
      crisp: false,
      time: 0,
    });
    expect(picture.figure).toBeNull();
    expect(picture.unitScale).toBeCloseTo(laneScale(SHORE_Y), 6);
  });

  it("uses the stamped German fighter, not the experimental 2.5D layers", () => {
    const clip = resolveQuickClip("GER", "fighter");
    expect(clip?.unitId).toBe("ger_fighter_seed1.stamped");
    if (!clip) return;
    const picture = fieldPicture({
      id: "fighter",
      clip,
      href: clip.file ?? "",
      offsets: STILL,
      mode: "moving",
      frame: 0,
      x: 40,
      y: 200,
      laneY: VANISH.y,
      crisp: true,
      time: 0.4,
    });
    expect(picture.figure?.parts).toHaveLength(1);
    expect(picture.figure?.parts[0]?.role).toBe("torso");
    expect(picture.figure?.parts[0]?.href).toBe(clip.file);
    expect(picture.unitScale).toBeCloseTo(laneScale(VANISH.y), 6);
  });

  it("still layers a 2.5D fighter when that experiment is asked for by name", () => {
    const clip: QuickClipRef = {
      unitId: "ger_fighter_seed1_25D",
      factionId: "GER",
      unitTypeId: "fighter",
      dir: "/assets/units/vector/frames/ger_fighter_seed1_25D",
      width: 144,
      height: 160,
      feet: { x: 97, y: 159 },
      resolution: 4,
      idle: 4,
      walk: 8,
      fire: 2,
      damaged: 2,
      fx: QUIET_QUICK_FX,
      fallback: false,
    };
    const picture = fieldPicture({
      id: "experiment",
      clip,
      href: "/flat.svg",
      offsets: STILL,
      mode: "moving",
      frame: 0,
      x: 40,
      y: 200,
      laneY: VANISH.y,
      crisp: true,
      time: 0.4,
    });
    expect(picture.figure?.parts.map((part) => part.role)).toEqual(["shadow", "tracks", "torso", "head", "weapon"]);
    expect(picture.figure?.parts[1]?.href).toContain("farWing.svg");
    expect(picture.figure?.parts[0]?.href).not.toBe("/flat.svg");
  });

  it("sets the contact oval from the art width, on the feet", () => {
    const clip = resolveQuickClip("GER", "tank");
    if (!clip) return;
    const spot = fieldContactLocal(clip, 1, 1, { x: 4, y: 2 });
    expect(spot.rx).toBeCloseTo((clip.width * 1.1) / 2, 5);
    expect(spot.x).toBeCloseTo(4, 5);
    expect(spot.y).toBeCloseTo(2, 5);
    expect(fieldContactLocal(clip, 1, -1, { x: 4, y: 0 }).x).toBeCloseTo(-4, 5);
  });
});

function blank(clip: NonNullable<ReturnType<typeof resolveQuickClip>>) {
  return {
    id: "far",
    clip,
    href: "/tank.svg",
    offsets: STILL,
    mode: "idle" as const,
    frame: 0,
    x: 0,
    y: VANISH.y,
    laneY: VANISH.y,
    crisp: true,
    time: 0,
  };
}
