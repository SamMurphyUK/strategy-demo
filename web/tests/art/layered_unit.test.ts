import { describe, expect, it } from "vitest";
import { rasterCardSlots } from "../../src/art/blockoutCompiler";
import {
  SLOT_GLYPH,
  beatGrid,
  decodeLayerRows,
  encodeLayerRows,
  fromLayeredFile,
  layeredUnitRelativePath,
  readUnitFile,
  renderCardStrip,
  savesAsLayeredUnit,
  toLayeredFile,
} from "../../src/art/layeredUnit";
import { PLAYBACK_BEATS } from "../../src/art/motionPreview";
import {
  fromPaintFile,
  moveRegionToLayer,
  rectMask,
  starterDocument,
  toPaintFile,
  withMotionShifts,
  type UnitPaintDocument,
} from "../../src/art/pixelPaint";
import { FACTION_MILITARY_MAPPINGS } from "../../src/art/starterParts";
import { MILITARY } from "../../src/ui/theme/militaryPalette";
import { parseBatchArgs, indexEntry } from "../../scripts/animateBatch.mjs";
import { choosePlates, parseImportArgs } from "../../scripts/importPlates.mjs";
import { TANK_PARTS, partCorners, shipPlate, tankPlate } from "./plateFixture";

function cutTank(): UnitPaintDocument {
  let doc = tankPlate();
  for (const layer of ["tracks", "turret", "barrel"] as const) {
    const { width, height } = doc.blueprint.canvasSize;
    doc = moveRegionToLayer(doc, rectMask(width, height, ...partCorners(TANK_PARTS[layer])), layer, true).doc;
  }
  return doc;
}

describe("the layered unit file", () => {
  it("is saved by faction and unit type", () => {
    expect(layeredUnitRelativePath("UK", "tank")).toBe("assets/layered/UK/tank.json");
    expect(layeredUnitRelativePath("USSR", "strategic_bomber")).toBe("assets/layered/USSR/strategic_bomber.json");
    expect(() => layeredUnitRelativePath("FRA", "tank")).toThrow(/roster faction/);
    expect(() => layeredUnitRelativePath("UK", "../tank")).toThrow(/unit type id/);
  });

  it("holds the idle layers at plate size, the ground point, the muzzle, the divisor, and the shifts", () => {
    const doc = cutTank();
    const file = toLayeredFile(doc);
    expect(file.kind).toBe("layered-unit");
    expect(file.version).toBe(1);
    expect(file.factionId).toBe("UK");
    expect(file.unitTypeId).toBe("tank");
    expect(file.archetype).toBe("tank");
    expect(file.canvasSize).toEqual(doc.blueprint.canvasSize);
    expect(file.groundOrigin).toEqual(doc.blueprint.groundOrigin);
    expect(file.muzzlePoint).toEqual(doc.blueprint.muzzlePoint);
    expect(file.displayDivisor).toBe(2);
    expect(file.shifts).toEqual({ bobPx: 2, recoilPx: 4, treadStride: 2 });
    expect(Object.keys(file.layers)).toEqual(["tracks", "hull", "turret", "barrel"]);
    expect(file.layers.hull).toHaveLength(doc.blueprint.canvasSize.height);
    expect(file.layers.hull!.every((row) => row.length === doc.blueprint.canvasSize.width)).toBe(true);
    expect("groundPoint" in file).toBe(false);
  });

  it("stores one pose, not four or eight", () => {
    const file = toLayeredFile(cutTank()) as unknown as Record<string, unknown>;
    expect(Object.keys(file).some((key) => /move|fire|frames/.test(key))).toBe(false);
    const paint = JSON.stringify(toPaintFile(cutTank())).length;
    expect(JSON.stringify(file).length).toBeLessThan(paint / 20);
  });

  it("writes its own legend", () => {
    const file = toLayeredFile(tankPlate());
    expect(file.legend).toEqual({
      ".": null,
      P: "primary_uniform_or_hull",
      S: "secondary_trim_or_webbing",
      M: "metallic_steel",
      T: "metallic_brass_or_track",
      W: "wood_or_leather",
      K: "skin_stand_in",
      I: "insignia_accent",
    });
    expect(new Set(Object.values(SLOT_GLYPH)).size).toBe(7);
  });

  it("reads back to the same unit, with the other poses built again", () => {
    const doc = cutTank();
    const back = fromLayeredFile(JSON.parse(JSON.stringify(toLayeredFile(doc))) as unknown);
    expect(back.archetype).toBe("tank");
    expect(back.layers).toEqual(doc.layers);
    expect(back.blueprint.frames).toEqual(doc.blueprint.frames);
    expect(back.blueprint.groundOrigin).toEqual(doc.blueprint.groundOrigin);
    expect(back.blueprint.muzzlePoint).toEqual(doc.blueprint.muzzlePoint);
    expect(back.blueprint.displayDivisor).toBe(doc.blueprint.displayDivisor);
    expect(back.blueprint.motion).toEqual(doc.blueprint.motion);
    expect(back.blueprint.blueprintId).toBe(doc.blueprint.blueprintId);
    expect(toLayeredFile(back)).toEqual(toLayeredFile(doc));
  });

  it("encodes a layer as one string a row and decodes it again", () => {
    const hull = cutTank().layers!.idle.hull!;
    const rows = encodeLayerRows(hull);
    expect(rows[0]).toMatch(/^\.+$/);
    expect(rows.some((row) => /P{20}/.test(row))).toBe(true);
    expect(decodeLayerRows(rows, hull[0]!.length, hull.length, "hull")).toEqual(hull);
  });

  it("refuses a file that is not a layered unit", () => {
    expect(() => fromLayeredFile(null)).toThrow(/not a layered unit/);
    expect(() => fromLayeredFile(toPaintFile(starterDocument("ger_tank_pz4")!))).toThrow(/not a layered unit/);
    expect(() => fromLayeredFile({ ...toLayeredFile(tankPlate()), version: 2 })).toThrow(/not a layered unit/);
  });

  it("refuses layers that belong to another skeleton", () => {
    const ship = toLayeredFile(shipPlate());
    expect(() => fromLayeredFile({ ...toLayeredFile(tankPlate()), layers: ship.layers })).toThrow(/no tracks layer/);
    expect(() => fromLayeredFile({ ...toLayeredFile(tankPlate()), unitTypeId: "destroyer" })).toThrow(/not drawn on the tank skeleton/);
    expect(() => fromLayeredFile({ ...toLayeredFile(tankPlate()), unitTypeId: "infantry", archetype: "infantry" })).toThrow(/vehicle/);
  });

  it("refuses a row of the wrong length, a character outside the legend, and a ground point off the canvas", () => {
    const file = toLayeredFile(tankPlate());
    const short = { ...file, layers: { ...file.layers, hull: file.layers.hull!.map((row, y) => (y === 3 ? row.slice(1) : row)) } };
    expect(() => fromLayeredFile(short)).toThrow(/Row 3 of the hull layer/);
    const odd = { ...file, layers: { ...file.layers, hull: file.layers.hull!.map((row, y) => (y === 0 ? `Z${row.slice(1)}` : row)) } };
    expect(() => fromLayeredFile(odd)).toThrow(/"Z", which is not in the legend/);
    expect(() => fromLayeredFile({ ...file, layers: { ...file.layers, hull: file.layers.hull!.slice(1) } })).toThrow(/rows/);
    expect(() => fromLayeredFile({ ...file, groundOrigin: { x: 9999, y: 0 } })).toThrow(/outside/);
    expect(() => fromLayeredFile({ ...file, displayDivisor: 2.5 })).toThrow(/displayDivisor/);
  });

  it("is the format for a plate, and unit-paint stays the format for a 48-pixel unit", () => {
    expect(savesAsLayeredUnit(tankPlate())).toBe(true);
    expect(savesAsLayeredUnit(starterDocument("ger_tank_pz4")!)).toBe(false);
    expect(savesAsLayeredUnit(starterDocument("ger_infantry_43")!)).toBe(false);
    expect(() => fromPaintFile(toPaintFile(tankPlate()))).toThrow(/48×48/);
    expect(() => toLayeredFile(starterDocument("ger_infantry_43")!)).toThrow(/vehicle/);
  });

  it("reads either kind of file", () => {
    expect(readUnitFile(toLayeredFile(tankPlate())).blueprint.displayDivisor).toBe(2);
    const starter = starterDocument("ger_tank_pz4")!;
    expect(readUnitFile(toPaintFile(starter)).blueprint.frames).toEqual(starter.blueprint.frames);
  });
});

describe("the card strip", () => {
  it("is eight 80×56 cards side by side, in beat order", () => {
    const strip = renderCardStrip(cutTank());
    expect(strip.width).toBe(640);
    expect(strip.height).toBe(56);
    expect(strip.cell).toEqual({ width: 80, height: 56 });
    expect(strip.beats).toEqual(PLAYBACK_BEATS.map((beat) => beat.name));
    expect(strip.rgba).toHaveLength(640 * 56 * 4);
    expect(strip.problems).toEqual([]);
  });

  it("is the same bytes every time, and after a save and a read", () => {
    const doc = cutTank();
    const first = renderCardStrip(doc);
    expect(renderCardStrip(doc).rgba).toEqual(first.rgba);
    const back = fromLayeredFile(JSON.parse(JSON.stringify(toLayeredFile(doc))) as unknown);
    expect(renderCardStrip(back).rgba).toEqual(first.rgba);
  });

  it("holds the painted pixels only: no outline, and nothing on a card's outer pixel", () => {
    const doc = cutTank();
    const strip = renderCardStrip(doc);
    const colours = new Set(Object.values(FACTION_MILITARY_MAPPINGS.UK).map((key) => MILITARY[key].toLowerCase()));
    PLAYBACK_BEATS.forEach((beat, cell) => {
      const sampled = rasterCardSlots(beatGrid(doc, beat), doc.blueprint);
      for (let y = 0; y < 56; y += 1) {
        for (let x = 0; x < 80; x += 1) {
          const offset = (y * 640 + cell * 80 + x) * 4;
          const opaque = strip.rgba[offset + 3] === 255;
          expect(opaque).toBe(sampled[y * 80 + x] != null);
          if (!opaque) {
            expect(strip.rgba[offset + 3]).toBe(0);
            continue;
          }
          expect(x > 0 && x < 79 && y > 0 && y < 55).toBe(true);
          const hex = `#${[0, 1, 2].map((channel) => strip.rgba[offset + channel]!.toString(16).padStart(2, "0")).join("")}`;
          expect(colours.has(hex)).toBe(true);
        }
      }
    });
  });

  it("shows the shot: the peak differs from the windup, and the windup from the idle", () => {
    const strip = renderCardStrip(cutTank());
    const cell = (index: number) => {
      const bytes: number[] = [];
      for (let y = 0; y < 56; y += 1) {
        bytes.push(...strip.rgba.subarray((y * 640 + index * 80) * 4, (y * 640 + index * 80 + 80) * 4));
      }
      return bytes;
    };
    expect(cell(2)).toEqual(cell(0));
    expect(cell(7)).toEqual(cell(0));
    expect(cell(6)).toEqual(cell(4));
    expect(cell(4)).not.toEqual(cell(0));
    expect(cell(5)).not.toEqual(cell(4));
    expect(cell(3)).not.toEqual(cell(0));
  });

  it("names what is wrong with a unit that would not export cleanly", () => {
    const wrong = withMotionShifts(cutTank(), { bobPx: 2, recoilPx: 2, treadStride: 3 });
    expect(renderCardStrip(wrong).problems).toEqual(["Recoil 2 is not a multiple of 4.", "Tread stride 3 is not a multiple of 2."]);
    // Uncut, the whole tank is hull, so a bob of four card pixels takes it off the bottom of the card.
    const tall = withMotionShifts(tankPlate(), { bobPx: 8, recoilPx: 4, treadStride: 2 });
    expect(renderCardStrip(tall).problems.some((problem) => /^move_2 leaves the card/.test(problem))).toBe(true);
  });
});

describe("the batch scripts", () => {
  it("read their arguments", () => {
    expect(parseBatchArgs([])).toEqual({ faction: null, unit: null, check: false, normalizeGrain: false });
    expect(parseBatchArgs(["--faction", "uk", "--unit", "TANK", "--check"])).toEqual({
      faction: "UK",
      unit: "tank",
      check: true,
      normalizeGrain: false,
    });
    expect(parseBatchArgs(["--normalize-grain"])).toEqual({ faction: null, unit: null, check: false, normalizeGrain: true });
    expect(() => parseBatchArgs(["--confirm"])).toThrow(/Unknown argument/);
    expect(parseImportArgs(["--faction", "uk", "--unit", "tank", "--force"])).toEqual({
      faction: "UK",
      unit: "tank",
      grade: null,
      picture: null,
      all: false,
      force: true,
    });
    expect(() => parseImportArgs([])).toThrow(/Say which plates/);
    expect(() => parseImportArgs(["--all", "--grade", "shiny"])).toThrow(/--grade/);
    expect(() => parseImportArgs(["--picture", "a.png"])).toThrow(/--faction and --unit/);
  });

  it("choose one picture a unit: promoted first, then the grade asked for, then the newest", () => {
    const row = (extra: Record<string, unknown>) => ({
      factionId: "UK",
      unitTypeId: "tank",
      blueprintId: "uk_tank",
      quantized: "a.png",
      updatedAt: "2026-11-19T08:00:00.000Z",
      ...extra,
    });
    const candidates = [
      row({ quantized: "peeled-old.png" }),
      row({ quantized: "outlined.png", grade: "outlined", updatedAt: "2026-11-19T07:00:00.000Z" }),
      row({ quantized: "peeled-new.png", updatedAt: "2026-11-19T09:00:00.000Z" }),
      row({ unitTypeId: "infantry", quantized: "rifle.png" }),
      row({ unitTypeId: "bomber", quantized: "bomber.png" }),
      row({ factionId: "US", quantized: "us.png" }),
    ];
    const all = { faction: null, unit: null, grade: null };
    expect(choosePlates(candidates, all).map((item: { quantized: string }) => item.quantized)).toEqual(["bomber.png", "outlined.png", "us.png"]);
    expect(choosePlates(candidates, all).map((item: { unitTypeId: string }) => item.unitTypeId)).toEqual(["strategic_bomber", "tank", "tank"]);
    expect(choosePlates(candidates, { ...all, grade: "peeled", faction: "UK", unit: "tank" })[0].quantized).toBe("peeled-new.png");
    const promoted = [...candidates, row({ quantized: "kept.png", promoted: true, updatedAt: "2026-11-01T00:00:00.000Z" })];
    expect(choosePlates(promoted, { ...all, faction: "UK", unit: "tank" })[0].quantized).toBe("kept.png");
    expect(choosePlates(candidates, { ...all, unit: "bomber" })).toHaveLength(1);
  });

  it("write an index row that says where the strip is and how to read it", () => {
    const doc = cutTank();
    const entry = indexEntry(doc, renderCardStrip(doc), "assets\\layered\\UK\\tank.json", "public\\assets\\units\\cards\\UK\\tank.png");
    expect(entry).toEqual({
      factionId: "UK",
      unitTypeId: "tank",
      blueprintId: "uk_tank",
      card: "assets/units/cards/UK/tank.png",
      layered: "assets/layered/UK/tank.json",
      cell: { width: 80, height: 56 },
      beats: PLAYBACK_BEATS.map((beat) => beat.name),
      fps: 11,
      footAnchor: { x: 40, y: 52 },
      displayDivisor: 2,
      outline: "drawn at display time",
    });
  });
});
