import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeRgbaPng } from "../../dev/pngRgba.mjs";
import { EMBLEMS, emblemBitmap, emblemById, emblemForFaction } from "../../src/art/emblems";
import {
  EMBLEM_HEX,
  compositeStamps,
  emptySidecar,
  opaquePixelCount,
  placementCells,
  polishedPngFor,
  readStampSidecar,
  spriteSilhouette,
  stampedPngPathFor,
  stampsPathFor,
  suggestEmblemSize,
  type SpritePixels,
  type StampPlacement,
} from "../../src/art/spriteStamps";
import { EMBLEM_SLOT_KEYS } from "../../src/art/skeletonSchema";

const BOMBER = "assets/candidates/US/us_bomber_seed1.outlined.polished.png";
const HULL = [0x8c, 0x7c, 0x79];

function webFile(relative: string): Buffer {
  return readFileSync(new URL(`../../${relative}`, import.meta.url));
}

function hexOf(data: ArrayLike<number>, offset: number): string {
  return `#${[data[offset]!, data[offset + 1]!, data[offset + 2]!].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/** A sprite with hull colour in the box [left, right) x [top, bottom) and clear everywhere else. */
function boxSprite(width: number, height: number, box: { left: number; top: number; right: number; bottom: number }): SpritePixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = box.top; y < box.bottom; y += 1) {
    for (let x = box.left; x < box.right; x += 1) {
      data.set([...HULL, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

function stamp(partial: Partial<StampPlacement> = {}): StampPlacement {
  return { emblem: "ussr_red_star", size: 17, x: 30, y: 20, flip: false, turn: false, onlyOnSprite: true, ...partial };
}

function palette(): Set<string> {
  const strip = decodeRgbaPng(webFile("public/assets/units/fading-16-32x.png"));
  const colours = new Set<string>();
  for (let index = 0; index < strip.width * strip.height; index += 1) {
    colours.add(hexOf(strip.data, index * 4));
  }
  return colours;
}

describe("stamp paths", () => {
  it("puts the stamps file and the stamped PNG beside the polished PNG", () => {
    expect(stampsPathFor(BOMBER)).toBe("assets/candidates/US/us_bomber_seed1.stamps.json");
    expect(stampedPngPathFor(BOMBER)).toBe("assets/candidates/US/us_bomber_seed1.outlined.stamped.png");
    expect(stampsPathFor(BOMBER.replaceAll("/", "\\"))).toBe("assets/candidates/US/us_bomber_seed1.stamps.json");
  });

  it("finds the polished PNG behind a polished or stamped path, and nothing else", () => {
    expect(polishedPngFor(BOMBER)).toBe(BOMBER);
    expect(polishedPngFor("assets/candidates/US/us_bomber_seed1.outlined.stamped.png")).toBe(BOMBER);
    expect(polishedPngFor("assets/candidates/US/us_bomber_seed1.outlined.quantized.png")).toBeNull();
  });

  it("never names the polished or quantized PNG as the stamped one, and refuses paths outside the candidates", () => {
    expect(stampedPngPathFor(BOMBER)).not.toBe(BOMBER);
    expect(stampedPngPathFor(BOMBER)).not.toMatch(/quantized|polished/);
    for (const bad of [
      "assets/candidates/US/us_bomber_seed1.outlined.quantized.png",
      "assets/candidates/US/../us_bomber_seed1.outlined.polished.png",
      "assets/candidates/XX/us_bomber_seed1.outlined.polished.png",
      "public/assets/units/us_bomber_seed1.outlined.polished.png",
      "",
    ]) {
      expect(() => stampsPathFor(bad), bad).toThrow();
      expect(() => stampedPngPathFor(bad), bad).toThrow();
    }
  });
});

describe("emblem colours on the large sprites", () => {
  it("are all six in the sixteen-colour palette the vectorizer snaps to", () => {
    const colours = palette();
    expect(colours.size).toBe(16);
    for (const slot of EMBLEM_SLOT_KEYS) {
      expect(colours.has(EMBLEM_HEX[slot].toLowerCase()), `${slot} ${EMBLEM_HEX[slot]}`).toBe(true);
    }
  });

  it("keep a real polished sprite inside the palette after stamping", () => {
    const sprite = decodeRgbaPng(webFile(BOMBER));
    const colours = palette();
    const { data, written } = compositeStamps(sprite, [
      stamp({ emblem: "us_star_and_bars", size: 41, x: 214, y: 90, turn: true, flip: true }),
      stamp({ emblem: "uk_roundel_type_c", size: 13, x: 40, y: 240, onlyOnSprite: false }),
    ]);
    expect(written[0]).toBeGreaterThan(1000);
    for (let index = 0; index < sprite.width * sprite.height; index += 1) {
      if (data[index * 4 + 3]! > 128) {
        expect(colours.has(hexOf(data, index * 4)), `pixel ${index}`).toBe(true);
      }
    }
  });
});

describe("compositing stamps", () => {
  const sprite = boxSprite(60, 40, { left: 10, top: 5, right: 50, bottom: 35 });

  it("writes exactly the emblem's pixels in its fixed colours, at full alpha, and nothing else", () => {
    const placement = stamp();
    const { data, written } = compositeStamps(sprite, [placement]);
    const bitmap = emblemBitmap(emblemById("ussr_red_star")!, 17);
    let changed = 0;
    for (let y = 0; y < 40; y += 1) {
      for (let x = 0; x < 60; x += 1) {
        const offset = (y * 60 + x) * 4;
        const slot = bitmap[y - 20 + 8]?.[x - 30 + 8] ?? null;
        if (slot) {
          expect(hexOf(data, offset), `${x}, ${y}`).toBe(EMBLEM_HEX[slot].toLowerCase());
          expect(data[offset + 3]).toBe(255);
          changed += 1;
        } else {
          expect([...data.slice(offset, offset + 4)], `${x}, ${y}`).toEqual([...(sprite.data as Uint8ClampedArray).slice(offset, offset + 4)]);
        }
      }
    }
    expect(written).toEqual([changed]);
  });

  it("does not change the picture it was given", () => {
    const before = Array.from(sprite.data);
    compositeStamps(sprite, [stamp(), stamp({ emblem: "jap_hinomaru", x: 12, y: 8 })]);
    expect(Array.from(sprite.data)).toEqual(before);
  });

  it("stays on the sprite when asked, and spills onto clear pixels when not", () => {
    const edge = stamp({ x: 10, y: 20 });
    const clipped = compositeStamps(sprite, [edge]);
    const onSprite = spriteSilhouette(sprite);
    for (let y = 0; y < 40; y += 1) {
      for (let x = 0; x < 60; x += 1) {
        if (!onSprite(x, y)) {
          expect(clipped.data[(y * 60 + x) * 4 + 3], `${x}, ${y}`).toBe(0);
        }
      }
    }
    const spilled = compositeStamps(sprite, [{ ...edge, onlyOnSprite: false }]);
    expect(spilled.written[0]).toBeGreaterThan(clipped.written[0]!);
    expect(spilled.data[(20 * 60 + 5) * 4 + 3]).toBe(255);
  });

  it("clips to the sprite as it was before any stamp", () => {
    const spill = stamp({ x: 10, y: 20, onlyOnSprite: false });
    const second = stamp({ emblem: "jap_hinomaru", size: 13, x: 6, y: 20 });
    const { written } = compositeStamps(sprite, [spill, second]);
    expect(written[1]).toBe(placementCells(sprite, second, spriteSilhouette(sprite)).length);
  });

  it("writes stamps in order, the later one on top", () => {
    const under = stamp({ emblem: "jap_hinomaru", size: 23 });
    const over = stamp({ emblem: "ussr_red_star", size: 13 });
    const { data } = compositeStamps(sprite, [under, over]);
    // The star's top point, where the disc under it is red.
    const tip = emblemBitmap(emblemById("ussr_red_star")!, 13)[0]![6]!;
    const disc = emblemBitmap(emblemById("jap_hinomaru")!, 23)[5]![11]!;
    expect(tip).not.toBe(disc);
    expect(hexOf(data, (14 * 60 + 30) * 4)).toBe(EMBLEM_HEX[tip].toLowerCase());
    expect(hexOf(compositeStamps(sprite, [over, under]).data, (14 * 60 + 30) * 4)).toBe(EMBLEM_HEX[disc].toLowerCase());
  });

  it("gives the hover preview the cells the composite writes", () => {
    const placement = stamp({ emblem: "us_star_and_bars", size: 13, x: 15, turn: true });
    const cells = placementCells(sprite, placement, spriteSilhouette(sprite));
    const { data } = compositeStamps(sprite, [placement]);
    for (const { x, y, slot } of cells) {
      expect(hexOf(data, (y * 60 + x) * 4)).toBe(EMBLEM_HEX[slot].toLowerCase());
    }
    expect(cells.length).toBe(compositeStamps(sprite, [placement]).written[0]);
  });

  it("counts drawn pixels above the vectorizer's alpha cut", () => {
    expect(opaquePixelCount(sprite)).toBe(40 * 30);
    const faint = { ...sprite, data: Uint8ClampedArray.from(sprite.data).map((value, index) => (index % 4 === 3 && value > 0 ? 128 : value)) };
    expect(opaquePixelCount(faint)).toBe(0);
  });

  it("refuses data of the wrong length", () => {
    expect(() => compositeStamps({ width: 4, height: 4, data: new Uint8ClampedArray(10) }, [])).toThrow();
  });
});

describe("the stamps file", () => {
  const good = {
    kind: "unit-stamps",
    version: 1,
    source: BOMBER,
    width: 368,
    height: 496,
    stamps: [{ emblem: "us_star_and_bars", size: 41, x: 214, y: 90, turn: true }],
  };

  it("reads a good file and fills in the defaults", () => {
    const file = readStampSidecar(good);
    expect(file.stamps[0]).toEqual({ emblem: "us_star_and_bars", size: 41, x: 214, y: 90, flip: false, turn: true, onlyOnSprite: true });
    expect(readStampSidecar(JSON.parse(JSON.stringify(file)))).toEqual(file);
    expect(emptySidecar(BOMBER, 368, 496).stamps).toEqual([]);
  });

  it("refuses an emblem, a size or a place that is not on offer", () => {
    const withStamp = (patch: Record<string, unknown>) => ({ ...good, stamps: [{ ...good.stamps[0], ...patch }] });
    expect(() => readStampSidecar(withStamp({ emblem: "ita_roundel" }))).toThrow(/not an emblem/);
    expect(() => readStampSidecar(withStamp({ size: 20 }))).toThrow(/not drawn at 20/);
    expect(() => readStampSidecar(withStamp({ x: 368 }))).toThrow();
    expect(() => readStampSidecar(withStamp({ y: -1 }))).toThrow();
    expect(() => readStampSidecar(withStamp({ x: 1.5 }))).toThrow();
    expect(() => readStampSidecar(withStamp({ flip: "yes" }))).toThrow();
    expect(() => readStampSidecar({ ...good, source: "assets/candidates/US/us_bomber_seed1.outlined.quantized.png" })).toThrow();
    expect(() => readStampSidecar({ ...good, kind: "unit-paint" })).toThrow();
    expect(() => readStampSidecar({ ...good, stamps: Array.from({ length: 65 }, () => good.stamps[0]) })).toThrow();
    expect(() => readStampSidecar(null)).toThrow();
  });
});

describe("the suggested size", () => {
  it("is always a drawn size", () => {
    for (const emblem of EMBLEMS) {
      for (const sprite of [
        { width: 48, height: 48 },
        { width: 96, height: 96, opaque: 2000 },
        { width: 512, height: 160, opaque: 35000 },
        { width: 368, height: 496, opaque: 51641 },
        { width: 4000, height: 4000 },
      ]) {
        expect(emblem.sizes.map((item) => item.size), `${emblem.id} ${sprite.width}`).toContain(suggestEmblemSize(emblem, sprite));
      }
    }
  });

  it("grows with the drawn area and never shrinks", () => {
    const star = emblemById("ussr_red_star")!;
    let last = 0;
    for (let opaque = 500; opaque <= 120_000; opaque += 500) {
      const size = suggestEmblemSize(star, { width: 600, height: 600, opaque });
      expect(size).toBeGreaterThanOrEqual(last);
      last = size;
    }
    expect(last).toBe(55);
  });

  it("gives a fighter and a T-34 17 pixels and a four-engine bomber 41", () => {
    const star = emblemById("ussr_red_star")!;
    expect(suggestEmblemSize(star, { width: 192, height: 96, opaque: 10170 })).toBe(17);
    expect(suggestEmblemSize(emblemById("uk_roundel_type_c")!, { width: 160, height: 176, opaque: 7557 })).toBe(17);
    expect(suggestEmblemSize(emblemById("us_star_and_bars")!, { width: 368, height: 496, opaque: 51641 })).toBe(41);
  });

  it("never suggests an emblem wider or taller than the sprite, unless even the smallest is", () => {
    const bars = emblemById("us_star_and_bars")!;
    expect(suggestEmblemSize(bars, { width: 70, height: 200, opaque: 60000 })).toBe(31);
    expect(suggestEmblemSize(bars, { width: 20, height: 20, opaque: 400 })).toBe(13);
  });

  it("has no emblem for a minor power, so there is nothing to suggest", () => {
    expect(emblemForFaction("MINOR")).toBeNull();
  });
});
