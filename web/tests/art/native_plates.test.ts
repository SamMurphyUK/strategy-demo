import { describe, expect, it } from "vitest";
import {
  LEGACY_SHIFTS,
  beatStack,
  buildAnimation,
  buildFirePose,
  compositeStack,
  emptyFrames,
  emptyGrid,
  motionRules,
  shiftProblems,
  shiftsForDivisor,
  stepBlur,
  stepHighlights,
  waterlineFoam,
} from "../../src/art/archetypeLayers";
import {
  cardCell,
  compileBlueprintFrame,
  firstPixelOffCard,
  plateSample,
  rasterCardAlbedo,
  rasterCardSlots,
} from "../../src/art/blockoutCompiler";
import { PLAYBACK_BEATS, POSE_FPS, playbackBeatAt, poseFiring, poseFrameAt } from "../../src/art/motionPreview";
import {
  PLATE_BODY_LAYER,
  fitDivisor,
  isPlate,
  placeGroundOrigin,
  plateDocument,
  plateProblems,
  plateShifts,
  starterDocument,
  withDisplayDivisor,
  withMotionShifts,
} from "../../src/art/pixelPaint";
import type { PaletteSlotKey, SpriteFrameGrid } from "../../src/art/skeletonSchema";
import { FACTION_MILITARY_MAPPINGS } from "../../src/art/starterParts";
import { TANK_PAD, TANK_PARTS, shipPlate, tankPlate } from "./plateFixture";

const GLYPH: Record<string, PaletteSlotKey | null> = {
  ".": null,
  P: "primary_uniform_or_hull",
  S: "secondary_trim_or_webbing",
  M: "metallic_steel",
  T: "metallic_brass_or_track",
  K: "skin_stand_in",
  I: "insignia_accent",
};
const NAME = new Map(Object.entries(GLYPH).map(([glyph, slot]) => [slot, glyph]));

function grid(rows: string[]): SpriteFrameGrid {
  return rows.map((row) => [...row].map((glyph) => GLYPH[glyph] ?? null));
}

function text(source: SpriteFrameGrid): string[] {
  return source.map((row) => row.map((slot) => NAME.get(slot) ?? "?").join(""));
}

function count(source: SpriteFrameGrid, slot: PaletteSlotKey): number {
  return source.flat().filter((cell) => cell === slot).length;
}

const ANCHOR = { x: 40, y: 52 };

describe("the card grid", () => {
  it("keeps the ground point on (40, 52) at every divisor", () => {
    for (const displayDivisor of [1, 2, 3, 4, 7]) {
      const placement = { groundOrigin: { x: 100, y: 90 }, sheetFootAnchor: ANCHOR, displayDivisor };
      expect(cardCell(placement, 100, 90)).toEqual(ANCHOR);
    }
  });

  it("hangs the blocks from the ground point: its row is the bottom of a block and its column the left", () => {
    const placement = { groundOrigin: { x: 100, y: 90 }, sheetFootAnchor: ANCHOR, displayDivisor: 3 };
    expect(cardCell(placement, 102, 88)).toEqual({ x: 40, y: 52 });
    expect(cardCell(placement, 103, 90)).toEqual({ x: 41, y: 52 });
    expect(cardCell(placement, 99, 91)).toEqual({ x: 39, y: 53 });
    expect(cardCell(placement, 100, 87)).toEqual({ x: 40, y: 51 });
  });

  it("samples the middle of the block a card pixel covers", () => {
    for (const displayDivisor of [1, 2, 3, 4]) {
      const placement = { groundOrigin: { x: 60, y: 70 }, sheetFootAnchor: ANCHOR, displayDivisor };
      for (const card of [ANCHOR, { x: 12, y: 30 }, { x: 70, y: 54 }]) {
        const sample = plateSample(placement, card.x, card.y);
        expect(cardCell(placement, sample.x, sample.y)).toEqual(card);
      }
    }
    expect(plateSample({ groundOrigin: { x: 60, y: 70 }, sheetFootAnchor: ANCHOR, displayDivisor: 3 }, 40, 52)).toEqual({ x: 61, y: 69 });
  });

  it("gives a divisor-sized block exactly one card pixel wherever it sits", () => {
    const divisor = 3;
    const placement = { groundOrigin: { x: 30, y: 40 }, sheetFootAnchor: ANCHOR, displayDivisor: divisor };
    for (let left = 10; left < 10 + divisor * 2; left += 1) {
      for (let top = 12; top < 12 + divisor * 2; top += 1) {
        const plate = emptyGrid(64, 64);
        for (let y = top; y < top + divisor; y += 1) {
          for (let x = left; x < left + divisor; x += 1) {
            plate[y]![x] = "skin_stand_in";
          }
        }
        expect(rasterCardSlots(plate, placement).filter((slot) => slot != null)).toHaveLength(1);
      }
    }
  });

  it("refuses a divisor that is not a whole number of 1 or more", () => {
    expect(() => cardCell({ groundOrigin: { x: 0, y: 0 }, sheetFootAnchor: ANCHOR, displayDivisor: 1.5 }, 0, 0)).toThrow(/whole number/);
    expect(() => cardCell({ groundOrigin: { x: 0, y: 0 }, sheetFootAnchor: ANCHOR, displayDivisor: 0 }, 0, 0)).toThrow(/whole number/);
  });
});

describe("a plate larger than the card", () => {
  it("opens at its own size and compiles, where the same canvas with no divisor is refused", () => {
    const doc = tankPlate();
    const { width, height } = doc.blueprint.canvasSize;
    expect(width).toBe(120 + TANK_PAD * 2);
    expect(height).toBe(36 + TANK_PAD * 2);
    expect(isPlate(doc)).toBe(true);
    const compiled = compileBlueprintFrame(doc.blueprint, "idle", FACTION_MILITARY_MAPPINGS.UK);
    expect(compiled.albedoKeys).toHaveLength(width * height);
    expect(compiled.albedoKeys.filter((key) => key != null).length).toBeGreaterThan(3000);
    const legacy = { ...doc.blueprint, displayDivisor: undefined };
    expect(() => compileBlueprintFrame(legacy, "idle", FACTION_MILITARY_MAPPINGS.UK)).toThrow(/80×56/);
  });

  it("checks each painted pixel where the divisor puts it", () => {
    const doc = tankPlate();
    const tight = { ...doc.blueprint, displayDivisor: 1 };
    expect(() => compileBlueprintFrame(tight, "idle", FACTION_MILITARY_MAPPINGS.UK)).toThrow(/leaves the ink margin/);
    expect(firstPixelOffCard(doc.blueprint.frames.idle, { ...doc.blueprint, displayDivisor: 1 })).not.toBeNull();
    expect(firstPixelOffCard(doc.blueprint.frames.idle, doc.blueprint)).toBeNull();
  });

  it("scales onto the card with the feet on the foot anchor and nothing on the outer pixel", () => {
    const doc = tankPlate();
    const keys = rasterCardAlbedo(doc.blueprint, "idle", FACTION_MILITARY_MAPPINGS.UK);
    expect(keys).toHaveLength(80 * 56);
    expect(keys[52 * 80 + 40]).toBe("charcoal");
    let inked = 0;
    keys.forEach((key, index) => {
      if (key == null) {
        return;
      }
      inked += 1;
      const x = index % 80;
      const y = Math.floor(index / 80);
      expect(x > 0 && x < 79 && y > 0 && y < 55).toBe(true);
    });
    // 120×36 at divisor 2 is 60 wide and 18 tall, less the corners the boxes leave empty.
    expect(inked).toBeGreaterThan(600);
    expect(inked).toBeLessThan(60 * 18);
  });

  it("leaves the first 48-pixel starters exactly as they were", () => {
    const doc = starterDocument("ger_tank_pz4");
    expect(doc).not.toBeNull();
    expect(doc!.blueprint.canvasSize).toEqual({ width: 48, height: 48 });
    expect(doc!.blueprint.displayDivisor).toBeUndefined();
    expect(isPlate(doc!)).toBe(false);
    expect(plateShifts(doc!)).toEqual(LEGACY_SHIFTS);
    const compiled = compileBlueprintFrame(doc!.blueprint, "idle", FACTION_MILITARY_MAPPINGS.GER);
    expect(compiled.sheetBlitOffset).toEqual({ x: 40 - doc!.blueprint.groundOrigin.x, y: 52 - doc!.blueprint.groundOrigin.y });
  });
});

describe("the display divisor", () => {
  it("is the smallest whole number at which the plate fits the card", () => {
    const doc = tankPlate();
    expect(doc.blueprint.displayDivisor).toBe(2);
    expect(fitDivisor(doc)).toBe(2);
    expect(plateProblems(doc)).toEqual([]);
  });

  it("is sized on every beat: foam that reaches off the card pushes it up", () => {
    const doc = shipPlate();
    expect(doc.blueprint.displayDivisor).toBe(2);
    const bow = doc.blueprint.muzzlePoint!.x;
    // The bow sits 77 plate pixels ahead of the ground point: card column 78 at divisor 2, the last one inside the margin.
    const moved = placeGroundOrigin(doc, bow - 77, doc.blueprint.groundOrigin.y);
    expect(firstPixelOffCard(moved.blueprint.frames.idle, moved.blueprint)).toBeNull();
    expect(plateProblems(moved).some((problem) => /^move_1 leaves the card/.test(problem))).toBe(true);
    expect(fitDivisor(moved)).toBe(3);
    expect(plateProblems(withMotionShifts(withDisplayDivisor(moved, 3), shiftsForDivisor(3)))).toEqual([]);
  });

  it("gives one card pixel of bob and tread and two of recoil", () => {
    expect(shiftsForDivisor(1)).toEqual(LEGACY_SHIFTS);
    expect(shiftsForDivisor(3)).toEqual({ bobPx: 3, recoilPx: 6, treadStride: 3 });
    expect(tankPlate().blueprint.motion).toEqual({ bobPx: 2, recoilPx: 4, treadStride: 2 });
  });

  it("names a shift that is not a whole number of card pixels", () => {
    expect(shiftProblems({ bobPx: 3, recoilPx: 6, treadStride: 3 }, 3)).toEqual([]);
    expect(shiftProblems({ bobPx: 6, recoilPx: 12, treadStride: 9 }, 3)).toEqual([]);
    expect(shiftProblems({ bobPx: 2, recoilPx: 6, treadStride: 3 }, 3)).toEqual(["Bob 2 is not a multiple of 3."]);
    expect(shiftProblems({ bobPx: 3, recoilPx: 6, treadStride: 4 }, 3)).toEqual(["Tread stride 4 is not a multiple of 3."]);
  });

  it("wants the recoil to be an even number of card pixels, because the windup is half of it", () => {
    expect(shiftProblems({ bobPx: 3, recoilPx: 3, treadStride: 3 }, 3)).toEqual(["Recoil 3 is not a multiple of 6."]);
    expect(shiftProblems({ bobPx: 3, recoilPx: 9, treadStride: 3 }, 3)).toEqual(["Recoil 9 is not a multiple of 6."]);
    expect(shiftProblems(LEGACY_SHIFTS, 1)).toEqual([]);
  });

  it("reports a plate whose shifts were typed in wrong, and stops reporting once they are right", () => {
    const doc = withMotionShifts(tankPlate(), { bobPx: 3, recoilPx: 4, treadStride: 2 });
    expect(plateProblems(doc)).toEqual(["Bob 3 is not a multiple of 2."]);
    expect(plateProblems(withMotionShifts(doc, { bobPx: 2, recoilPx: 4, treadStride: 2 }))).toEqual([]);
  });
});

describe("shifts scaled to the plate", () => {
  it("moves the tank by the plate's shifts", () => {
    const rules = motionRules("tank", "tank", { bobPx: 3, recoilPx: 6, treadStride: 3 });
    expect(rules.move_2.shift).toEqual({ hull: [0, 3], turret: [0, 3], barrel: [0, 3] });
    expect(rules.fire.shift).toEqual({ hull: [0, 3], turret: [-3, 3], barrel: [-6, 3] });
  });

  it("gives whatever carries the gun half the recoil", () => {
    const shifts = { bobPx: 4, recoilPx: 8, treadStride: 4 };
    expect(motionRules("mech_infantry", "mech_infantry", shifts).fire.shift).toEqual({ crew_gun: [-4, 0] });
    expect(motionRules("artillery", "artillery", shifts).fire.shift).toEqual({
      carriage_wheels: [-4, 0],
      gun_shield: [-4, 0],
      barrel_breech: [-8, 0],
    });
    expect(motionRules("artillery", "aaa", shifts).fire.shift.barrel_breech).toEqual([-4, 4]);
    expect(motionRules("aircraft", "fighter", shifts).fire.shift.fuselage_wings).toEqual([-4, 0]);
    expect(motionRules("ship", "cruiser", shifts).move_2.shift.hull_waterline).toEqual([0, -4]);
  });

  it("moves by the 48-pixel amounts when no shifts are given", () => {
    for (const [archetype, unit] of [
      ["tank", "tank"],
      ["mech_infantry", "mech_infantry"],
      ["artillery", "artillery"],
      ["artillery", "aaa"],
      ["aircraft", "fighter"],
      ["ship", "destroyer"],
    ] as const) {
      expect(motionRules(archetype, unit)).toEqual(motionRules(archetype, unit, LEGACY_SHIFTS));
    }
    expect(motionRules("tank", "tank").fire.shift).toEqual({ hull: [0, 1], turret: [-1, 1], barrel: [-2, 1] });
  });

  it("steps a tread by the stride and keeps the layer's shape", () => {
    const tread = grid(["TTTMMMTTTMMMTTT", ".TTMMMTTTTTTTT.", "PPMMM..TTMMMTT."]);
    expect(text(stepHighlights(tread, 3))).toEqual(["TTTTTTMMMTTTMMM", ".TTTTTMMMTTTTT.", "PPPPP..TTTTTMM."]);
    expect(text(stepHighlights(tread, 3)).map((row) => row.replace(/[^.]/g, "#"))).toEqual(
      text(tread).map((row) => row.replace(/[^.]/g, "#")),
    );
  });

  it("steps a tread one pixel when no stride is given, as it always has", () => {
    const tread = grid([".TMTMTMT.", ".TMMPTTM.", "..TTTTT..", "MTTTTTTT."]);
    expect(text(stepHighlights(tread))).toEqual([".TTMTMTM.", ".TPMMTTT.", "..TTTTT..", "TMTTTTTT."]);
    expect(stepHighlights(tread, 1)).toEqual(stepHighlights(tread));
  });

  it("steps the propeller dashes by the stride", () => {
    const blur = grid(["M..", "...", "...", ".P."]);
    expect(text(stepBlur(blur, 2))).toEqual(["...", "...", "M..", ".P."]);
    expect(text(stepBlur(blur))).toEqual(["...", "M..", "...", ".P."]);
  });

  it("draws foam in blocks one card pixel across", () => {
    const hull = emptyGrid(40, 12);
    for (let y = 4; y < 10; y += 1) {
      for (let x = 12; x < 28; x += 1) {
        hull[y]![x] = "primary_uniform_or_hull";
      }
    }
    const thrown = waterlineFoam(hull, 0, 3);
    // Ahead of the bow, one block back from it, behind the stern, one block in from it: four blocks of nine.
    expect(count(thrown, "skin_stand_in")).toBe(36);
    for (const [x, y] of [
      [28, 7],
      [30, 9],
      [22, 9],
      [24, 7],
      [9, 7],
      [11, 9],
      [15, 8],
      [17, 9],
    ] as const) {
      expect(thrown[y]![x]).toBe("skin_stand_in");
    }
    expect(thrown[6]![28]).toBeNull();
    expect(thrown[9]![31]).toBeNull();
    const placement = { groundOrigin: { x: 20, y: 9 }, sheetFootAnchor: ANCHOR, displayDivisor: 3 };
    expect(rasterCardSlots(thrown, placement).filter((slot) => slot === "skin_stand_in")).toHaveLength(4);
    expect(text(waterlineFoam(grid(["..PPPP.."]), 0))).toEqual([".KPKKPK."]);
  });

  it("paints the flash in blocks one card pixel across", () => {
    const frames = emptyFrames("tank", 60, 30);
    for (let x = 10; x <= 40; x += 1) {
      frames.idle.barrel![15]![x] = "primary_uniform_or_hull";
    }
    const built = buildAnimation("tank", frames, {
      unitTypeId: "tank",
      groundX: 20,
      muzzlePoint: { x: 40, y: 15 },
      shifts: shiftsForDivisor(3),
      unit: 3,
    });
    const barrel = built.fire.barrel!;
    expect(count(barrel, "skin_stand_in")).toBe(18);
    expect(count(barrel, "insignia_accent")).toBe(18);
    // The barrel went back six and down three, and the flash went with its tip.
    expect(barrel[18]![35]).toBe("skin_stand_in");
    expect(barrel[18]![40]).toBe("skin_stand_in");
    expect(barrel[15]![36]).toBe("insignia_accent");
    expect(barrel[21]![36]).toBe("insignia_accent");
    const placement = { groundOrigin: { x: 20, y: 25 }, sheetFootAnchor: ANCHOR, displayDivisor: 3 };
    const card = rasterCardSlots(barrel, placement);
    expect(card.filter((slot) => slot === "skin_stand_in")).toHaveLength(2);
    expect(card.filter((slot) => slot === "insignia_accent")).toHaveLength(2);
  });
});

describe("the eight beats", () => {
  it("are two steps and a shot that winds up, peaks, and recovers", () => {
    expect(PLAYBACK_BEATS.map((beat) => beat.name)).toEqual([
      "idle",
      "move_1",
      "idle_2",
      "move_2",
      "fire_windup",
      "fire_peak",
      "fire_recover",
      "idle_settle",
    ]);
    expect(PLAYBACK_BEATS.map((beat) => beat.recoil)).toEqual([0, 0, 0, 0, 0.5, 1, 0.5, 0]);
  });

  it("plays the march, and a four-beat shot every 16 ticks", () => {
    const names = Array.from({ length: 16 }, (_, tick) => playbackBeatAt((tick + 0.5) / POSE_FPS).name);
    expect(names.slice(0, 4)).toEqual(["fire_windup", "fire_peak", "fire_recover", "idle_settle"]);
    expect(names.slice(4, 8)).toEqual(["idle", "move_1", "idle_2", "move_2"]);
    expect(names.slice(8)).toEqual([...names.slice(4, 8), ...names.slice(4, 8)]);
    expect(playbackBeatAt(16.5 / POSE_FPS).name).toBe("fire_windup");
  });

  it("leaves the four-pose clock as it was", () => {
    expect(poseFrameAt(0, true)).toBe("fire");
    expect([0, 1, 2, 3].map((tick) => poseFrameAt((tick + 0.5) / POSE_FPS, false))).toEqual(["idle", "move_1", "idle", "move_2"]);
    expect(poseFiring(0.5 / POSE_FPS)).toBe(true);
    expect(poseFiring(2.5 / POSE_FPS)).toBe(false);
  });

  it("builds the windup from the idle layers: the barrel is half way back and there is no flash", () => {
    const frames = emptyFrames("tank", 60, 30);
    for (let x = 10; x <= 40; x += 1) {
      frames.idle.barrel![15]![x] = "primary_uniform_or_hull";
      frames.idle.turret![16]![x - 5] = "secondary_trim_or_webbing";
      frames.idle.hull![17]![x - 5] = "primary_uniform_or_hull";
    }
    const options = { unitTypeId: "tank", groundX: 20, muzzlePoint: { x: 40, y: 15 }, shifts: shiftsForDivisor(3), unit: 3 };
    const half = buildFirePose("tank", frames.idle, options, 0.5);
    // Half of six is three. Half of the turret's three and of the hull's three is less than a block, so they wait.
    expect(half.barrel![15]![37]).toBe("primary_uniform_or_hull");
    expect(half.barrel![15]![38]).toBeNull();
    expect(half.barrel![15]![7]).toBe("primary_uniform_or_hull");
    expect(half.turret).toEqual(frames.idle.turret);
    expect(half.hull).toEqual(frames.idle.hull);
    expect(count(half.barrel!, "skin_stand_in")).toBe(0);
    const whole = buildFirePose("tank", frames.idle, options, 1);
    expect(whole).toEqual(buildAnimation("tank", frames, options).fire);
  });

  it("serves the stored pose on a whole beat and the built pose on a half beat", () => {
    const doc = tankPlate();
    const options = { unitTypeId: "tank", groundX: doc.blueprint.groundOrigin.x, muzzlePoint: doc.blueprint.muzzlePoint, shifts: plateShifts(doc), unit: 2 };
    const layers = doc.layers!;
    expect(beatStack("tank", layers, PLAYBACK_BEATS[1]!, options)).toBe(layers.move_1);
    expect(beatStack("tank", layers, PLAYBACK_BEATS[5]!, options)).toBe(layers.fire);
    const windup = beatStack("tank", layers, PLAYBACK_BEATS[4]!, options);
    expect(windup).not.toBe(layers.fire);
    expect(windup).toEqual(buildFirePose("tank", layers.idle, options, 0.5));
  });
});

describe("opening a baked picture as a plate", () => {
  it("puts the whole picture on the body layer, cropped to its ink", () => {
    const doc = tankPlate();
    expect(doc.archetype).toBe("tank");
    expect(PLATE_BODY_LAYER.tank).toBe("hull");
    expect(doc.layers!.idle.hull).toEqual(doc.blueprint.frames.idle);
    for (const layer of ["tracks", "turret", "barrel"]) {
      expect(doc.layers!.idle[layer]!.flat().every((slot) => slot == null)).toBe(true);
    }
    const idle = doc.blueprint.frames.idle;
    expect(idle[TANK_PARTS.hull.y + TANK_PAD]![TANK_PAD]).toBe("primary_uniform_or_hull");
    expect(idle[TANK_PARTS.tracks.y + TANK_PAD]![TANK_PARTS.tracks.x + TANK_PAD]).toBe("metallic_brass_or_track");
    expect(idle[TANK_PARTS.turret.y + TANK_PAD]![TANK_PARTS.turret.x + TANK_PAD]).toBe("secondary_trim_or_webbing");
    expect(idle[TANK_PARTS.barrel.y + TANK_PAD]![119 + TANK_PAD]).toBe("wood_or_leather");
    expect(count(idle, "primary_uniform_or_hull") + count(idle, "metallic_brass_or_track")).toBeGreaterThan(2000);
  });

  it("stands it on the bottom middle of its ink and marks the muzzle at its right-hand tip", () => {
    const doc = tankPlate();
    expect(doc.blueprint.groundOrigin).toEqual({ x: TANK_PAD + 59, y: TANK_PAD + 35 });
    expect(doc.blueprint.muzzlePoint).toEqual({ x: TANK_PAD + 119, y: TANK_PAD + 4 });
  });

  it("builds the other three poses straight away", () => {
    const doc = tankPlate();
    const bob = doc.blueprint.motion!.bobPx;
    const ground = doc.blueprint.groundOrigin;
    // Nothing is cut yet, so the whole tank is hull and drops together on the second step.
    expect(doc.blueprint.frames.move_1).toEqual(doc.blueprint.frames.idle);
    expect(doc.blueprint.frames.move_2[ground.y + bob]![ground.x]).toBe("metallic_brass_or_track");
    expect(doc.blueprint.frames.idle[ground.y + bob]![ground.x]).toBeNull();
    expect(compositeStack("tank", doc.layers!.fire)).toEqual(doc.blueprint.frames.fire);
  });

  it("refuses a rifleman and an empty picture", () => {
    const blank = { rgba: new Uint8ClampedArray(16 * 16 * 4), width: 16, height: 16 };
    expect(() => tankPlate("GER")).not.toThrow();
    expect(() => plateDocumentFor("infantry", blank)).toThrow(/vehicle/);
    expect(() => plateDocumentFor("tank", blank)).toThrow(/empty/);
  });
});

function plateDocumentFor(unitTypeId: string, picture: { rgba: Uint8ClampedArray; width: number; height: number }) {
  return plateDocument({ factionId: "UK", unitTypeId, ...picture });
}
