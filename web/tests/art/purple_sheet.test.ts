import { describe, expect, it } from "vitest";
import { AS_DRAWN_LUT, LAYER_ORDER, type SpriteFrame } from "../../src/art/frameClips";
import { GEN_KEY } from "../../src/art/partGen";
import {
  PURPLE_COLUMNS,
  PURPLE_GAP,
  PURPLE_PALETTE,
  PURPLE_SWATCH,
  purpleSheet,
  purpleSheetGrid,
} from "../../src/art/purpleSheet";
import { MILITARY } from "../../src/ui/theme/militaryPalette";
import type { PartCategory } from "../../src/art/paperDoll";

function pixel(rgba: Uint8ClampedArray, width: number, x: number, y: number): number[] {
  const index = (y * width + x) * 4;
  return [rgba[index] ?? 0, rgba[index + 1] ?? 0, rgba[index + 2] ?? 0, rgba[index + 3] ?? 0];
}

function rgb(hex: string): number[] {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
}

function blank(width: number, height: number): SpriteFrame {
  const cells = () => new Array<number>(width * height).fill(0);
  return {
    width,
    height,
    layers: { legs: cells(), torso: cells(), head: cells(), weapon: cells() },
    muzzle: null,
    flash: false,
  };
}

describe("purple sheet", () => {
  it("lays eight frames out as four by two, and a shorter clip on one row", () => {
    expect(purpleSheetGrid(8)).toEqual({ columns: PURPLE_COLUMNS, rows: 2 });
    expect(purpleSheetGrid(4)).toEqual({ columns: 4, rows: 1 });
    expect(purpleSheetGrid(2)).toEqual({ columns: 2, rows: 1 });
    expect(purpleSheetGrid(1)).toEqual({ columns: 1, rows: 1 });
  });

  it("paints the clip on magenta and puts the 16 colours under the grid", () => {
    const first = blank(2, 2);
    const second = blank(2, 2);
    first.layers.torso[0] = 5;
    second.layers.legs[0] = 1;
    const sheet = purpleSheet([first, second], [...LAYER_ORDER], AS_DRAWN_LUT);
    expect(sheet.columns).toBe(2);
    expect(sheet.rows).toBe(1);
    expect(sheet.width).toBe(PURPLE_PALETTE.length * PURPLE_SWATCH);
    expect(sheet.height).toBe(2 + PURPLE_GAP + PURPLE_SWATCH);
    expect(pixel(sheet.rgba, sheet.width, 0, 0)).toEqual(rgb(AS_DRAWN_LUT[5] ?? ""));
    expect(pixel(sheet.rgba, sheet.width, 2, 0)).toEqual(rgb(AS_DRAWN_LUT[1] ?? ""));
    expect(pixel(sheet.rgba, sheet.width, 1, 0)).toEqual([...GEN_KEY, 255]);
    expect(pixel(sheet.rgba, sheet.width, 0, 2)).toEqual([...GEN_KEY, 255]);
    expect(pixel(sheet.rgba, sheet.width, 0, 2 + PURPLE_GAP)).toEqual(rgb(MILITARY.cream));
    expect(PURPLE_PALETTE).toHaveLength(16);
  });

  it("leaves every unticked layer magenta, and keeps a later layer on top of the full sheet", () => {
    const frame = blank(2, 2);
    frame.layers.legs[0] = 1;
    frame.layers.torso[0] = 5;
    const full = purpleSheet([frame], [...LAYER_ORDER], AS_DRAWN_LUT);
    const legs = purpleSheet([frame], ["legs"], AS_DRAWN_LUT);
    expect(pixel(full.rgba, full.width, 0, 0)).toEqual(rgb(AS_DRAWN_LUT[5] ?? ""));
    expect(pixel(legs.rgba, legs.width, 0, 0)).toEqual(rgb(AS_DRAWN_LUT[1] ?? ""));
    expect(pixel(legs.rgba, legs.width, 0, 0)).not.toEqual(pixel(full.rgba, full.width, 0, 0));
  });

  it("draws the muzzle flash on the full sheet and leaves it off a single layer", () => {
    const frame = blank(8, 2);
    frame.flash = true;
    frame.muzzle = { x: 0, y: 1 };
    const full = purpleSheet([frame], [...LAYER_ORDER], AS_DRAWN_LUT, { flash: true });
    const one: PartCategory[] = ["torso"];
    const layer = purpleSheet([frame], one, AS_DRAWN_LUT);
    expect(pixel(full.rgba, full.width, 1, 1)).toEqual(rgb(MILITARY.cream));
    expect(pixel(layer.rgba, layer.width, 1, 1)).toEqual([...GEN_KEY, 255]);
  });

  it("places the fifth frame on the second row", () => {
    const frames = Array.from({ length: 5 }, () => blank(2, 2));
    frames[4]!.layers.head[0] = 5;
    const sheet = purpleSheet(frames, ["head"], AS_DRAWN_LUT);
    expect(sheet).toMatchObject({ columns: 4, rows: 2 });
    expect(pixel(sheet.rgba, sheet.width, 0, 2)).toEqual(rgb(AS_DRAWN_LUT[5] ?? ""));
    expect(pixel(sheet.rgba, sheet.width, 2, 2)).toEqual([...GEN_KEY, 255]);
  });

  it("refuses an empty clip and frames that differ in size", () => {
    expect(() => purpleSheet([], ["torso"], AS_DRAWN_LUT)).toThrow(/no frames/);
    expect(() => purpleSheet([blank(2, 2), blank(3, 2)], ["torso"], AS_DRAWN_LUT)).toThrow(/same size/);
  });
});
