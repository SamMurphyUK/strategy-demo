import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EMBLEMS,
  EMBLEM_GLYPH,
  UNSUPPORTED_FACTIONS,
  emblemBitmap,
  emblemById,
  emblemCells,
  emblemForFaction,
  silhouetteOf,
  stampEmblem,
  type Emblem,
  type EmblemBitmap,
} from "../../src/art/emblems";
import { decodeLayerRows, encodeLayerRows, fromLayeredFile, toLayeredFile } from "../../src/art/layeredUnit";
import { tankPlate } from "./plateFixture";
import { ROSTER_FACTIONS, blankDocument, paintAt, slotHex, stampEmblemAt, stampPreviewCells, withEditingLayer } from "../../src/art/pixelPaint";
import { EMBLEM_SLOT_KEYS, EMBLEM_STRIP, stripKeyOfSlot, type PaletteSlotKey, type SpriteFrameGrid } from "../../src/art/skeletonSchema";
import { FACTION_MILITARY_MAPPINGS } from "../../src/art/starterParts";

const HULL: PaletteSlotKey = "primary_uniform_or_hull";

function blank(width: number, height: number, slot: PaletteSlotKey | null = null): SpriteFrameGrid {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => slot));
}

function opaque(bitmap: EmblemBitmap): number {
  return bitmap.flat().filter((slot) => slot != null).length;
}

const everyBitmap: { emblem: Emblem; size: number; bitmap: EmblemBitmap }[] = EMBLEMS.flatMap((emblem) =>
  emblem.sizes.map((item) => ({ emblem, size: item.size, bitmap: emblemBitmap(emblem, item.size) })),
);

describe("emblem data", () => {
  it("has an emblem for every country on the roster, or lists it as unsupported", () => {
    for (const faction of ROSTER_FACTIONS) {
      const unsupported = UNSUPPORTED_FACTIONS.includes(faction);
      expect(emblemForFaction(faction) === null, faction).toBe(unsupported);
    }
    expect(EMBLEMS.filter((emblem) => emblem.kind !== "marking").map((emblem) => emblem.faction)).toEqual(["GER", "USSR", "US", "UK", "JAP"]);
  });

  it("covers every faction in data/factions.json", () => {
    // The roster ids the art uses for the ids in the shared data. A new faction has to be added here, and so given an emblem or listed as unsupported.
    const roster: Record<string, (typeof ROSTER_FACTIONS)[number]> = { germany: "GER", uk: "UK" };
    const file = JSON.parse(readFileSync(new URL("../../../data/factions.json", import.meta.url), "utf8")) as { factions: { id: string }[] };
    expect(file.factions.length).toBeGreaterThan(0);
    for (const { id } of file.factions) {
      const faction = roster[id];
      expect(faction, `${id} is not mapped to a roster country`).toBeDefined();
      expect(emblemForFaction(faction!) !== null || UNSUPPORTED_FACTIONS.includes(faction!), id).toBe(true);
    }
  });

  it("has unique ids and finds each by id", () => {
    expect(new Set(EMBLEMS.map((emblem) => emblem.id)).size).toBe(EMBLEMS.length);
    for (const emblem of EMBLEMS) {
      expect(emblemById(emblem.id)).toBe(emblem);
    }
    expect(emblemById("nope")).toBeNull();
  });

  it("is drawn in emblem colours only", () => {
    for (const emblem of EMBLEMS) {
      for (const item of emblem.sizes) {
        for (const row of item.rows) {
          for (const glyph of row) {
            expect(glyph === "." || glyph in EMBLEM_GLYPH, `${emblem.id} ${item.size}: "${glyph}"`).toBe(true);
          }
        }
      }
    }
    for (const { bitmap } of everyBitmap) {
      for (const slot of bitmap.flat()) {
        expect(slot === null || EMBLEM_SLOT_KEYS.includes(slot)).toBe(true);
      }
    }
  });

  it("has three or more sizes, rectangular, non-empty, with a middle pixel", () => {
    for (const emblem of EMBLEMS) {
      expect(emblem.sizes.length, emblem.id).toBeGreaterThanOrEqual(3);
      for (const item of emblem.sizes) {
        const label = `${emblem.id} ${item.size}`;
        expect(item.rows.length, label).toBe(item.height);
        expect(item.rows.every((row) => row.length === item.width), label).toBe(true);
        expect(item.height, label).toBe(item.size);
        expect(item.width % 2, label).toBe(1);
        expect(item.height % 2, label).toBe(1);
        expect(item.rows.join("").replace(/\./g, "").length, label).toBeGreaterThan(0);
      }
    }
  });

  it("lists sizes smallest first, each bigger than the one before", () => {
    for (const emblem of EMBLEMS) {
      for (let index = 1; index < emblem.sizes.length; index += 1) {
        const before = emblem.sizes[index - 1]!;
        const item = emblem.sizes[index]!;
        expect(item.size, emblem.id).toBeGreaterThan(before.size);
        expect(item.width, emblem.id).toBeGreaterThan(before.width);
        expect(item.rows.join("").replace(/\./g, "").length, emblem.id).toBeGreaterThan(before.rows.join("").replace(/\./g, "").length);
      }
    }
  });

  it("has a dark outline: every pixel on the edge of the shape is the dark colour", () => {
    for (const { emblem, size, bitmap } of everyBitmap) {
      bitmap.forEach((row, y) =>
        row.forEach((slot, x) => {
          if (slot == null) {
            return;
          }
          const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (bitmap[y! + dy!]?.[x! + dx!] ?? null) === null);
          if (edge) {
            expect(slot, `${emblem.id} ${size} at ${x}, ${y}`).toBe("emblem_dark");
          }
        }),
      );
    }
  });

  it("draws every size by hand: no size is a whole-number scale-up of the one below", () => {
    for (const emblem of EMBLEMS) {
      for (let index = 1; index < emblem.sizes.length; index += 1) {
        const small = emblem.sizes[index - 1]!;
        const big = emblem.sizes[index]!;
        for (let factor = 2; factor * small.height <= big.height; factor += 1) {
          const scaled = big.height === factor * small.height && big.width === factor * small.width;
          expect(scaled, `${emblem.id} ${big.size}`).toBe(false);
        }
      }
    }
  });

  it("lights red from the top left: a lit red pixel has a top or a left edge showing", () => {
    const red = (slot: string | null | undefined) => slot === "emblem_red" || slot === "emblem_red_light";
    for (const { emblem, size, bitmap } of everyBitmap) {
      let lit = 0;
      bitmap.forEach((row, y) =>
        row.forEach((slot, x) => {
          if (slot === "emblem_red_light") {
            lit += 1;
            expect(!(red(bitmap[y - 1]?.[x]) && red(row[x - 1])), `${emblem.id} ${size} lit red at ${x}, ${y}`).toBe(true);
          }
        }),
      );
      if (emblem.faction === "USSR" || emblem.faction === "JAP") {
        expect(lit, `${emblem.id} ${size}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("emblem colours and the country", () => {
  it("resolve to the same colour whichever country the sprite is filed under", () => {
    for (const faction of ROSTER_FACTIONS) {
      for (const slot of EMBLEM_SLOT_KEYS) {
        expect(stripKeyOfSlot(FACTION_MILITARY_MAPPINGS[faction], slot), `${faction} ${slot}`).toBe(EMBLEM_STRIP[slot]);
      }
    }
    expect(slotHex(FACTION_MILITARY_MAPPINGS.USSR, "emblem_red")).toBe(slotHex(FACTION_MILITARY_MAPPINGS.UK, "emblem_red"));
  });

  it("leave the recolour slots on the country's own mapping", () => {
    expect(stripKeyOfSlot(FACTION_MILITARY_MAPPINGS.GER, HULL)).toBe("feldgrau");
    expect(stripKeyOfSlot(FACTION_MILITARY_MAPPINGS.USSR, HULL)).toBe("crimson");
  });

  it("are the sixteen-colour strip's own colours", () => {
    expect(Object.values(EMBLEM_STRIP)).toEqual(["charcoal", "crimson", "terracotta", "cream", "bone", "steel", "feldgrau", "spruce"]);
  });

  it("save in a plate's layered file, in the legend only when a stamp is in it, and open again as the same pixels", () => {
    const plate = tankPlate("GER");
    expect(Object.keys(toLayeredFile(plate).legend).sort()).toEqual([".", "I", "K", "M", "P", "S", "T", "W"]);
    const { width, height } = plate.blueprint.canvasSize;
    const stamped = stampEmblemAt(plate, emblemBitmap(emblemById("ger_balkenkreuz")!, 17), Math.floor(width / 2), Math.floor(height / 2), true);
    expect(stamped).not.toBe(plate);
    const file = toLayeredFile(stamped);
    expect(file.legend.D).toBe("emblem_dark");
    expect(file.legend.O).toBe("emblem_white_shade");
    expect(file.legend.G).toBe("emblem_grey");
    expect(file.legend.C).toBeUndefined();
    expect(file.legend.R).toBeUndefined();
    const reopened = fromLayeredFile(JSON.parse(JSON.stringify(file)));
    expect(reopened.layers!.idle).toEqual(stamped.layers!.idle);
  });

  it("write into a layer file and read back", () => {
    const stamped = stampEmblem(blank(40, 40, HULL), emblemBitmap(emblemById("uk_roundel_type_c")!, 17), { x: 20, y: 20 });
    expect(decodeLayerRows(encodeLayerRows(stamped), 40, 40, "hull")).toEqual(stamped);
  });
});

describe("stamping", () => {
  const star = emblemById("ussr_red_star")!;
  const bitmap = emblemBitmap(star, 17);

  it("writes exactly the emblem's pixels at the given offset", () => {
    const grid = blank(50, 50);
    const stamped = stampEmblem(grid, bitmap, { x: 25, y: 24 });
    const left = 25 - 8;
    const top = 24 - 8;
    for (let y = 0; y < 50; y += 1) {
      for (let x = 0; x < 50; x += 1) {
        const inside = x >= left && x < left + 17 && y >= top && y < top + 17;
        expect(stamped[y]![x], `${x}, ${y}`).toBe(inside ? bitmap[y - top]![x - left] : null);
      }
    }
    expect(stamped.flat().filter((slot) => slot != null).length).toBe(opaque(bitmap));
  });

  it("does not change the grid it was given, and shares the rows it did not touch", () => {
    const grid = blank(50, 50, HULL);
    const before = JSON.stringify(grid);
    const stamped = stampEmblem(grid, bitmap, { x: 25, y: 25 });
    expect(JSON.stringify(grid)).toBe(before);
    expect(stamped).not.toBe(grid);
    expect(stamped[0]).toBe(grid[0]);
    expect(stamped[25]).not.toBe(grid[25]);
  });

  it("leaves the cells under the emblem's clear pixels alone", () => {
    const stamped = stampEmblem(blank(50, 50, HULL), bitmap, { x: 25, y: 25 });
    const left = 25 - 8;
    const top = 25 - 8;
    let kept = 0;
    bitmap.forEach((row, y) =>
      row.forEach((slot, x) => {
        if (slot == null) {
          expect(stamped[top + y]![left + x]).toBe(HULL);
          kept += 1;
        } else {
          expect(stamped[top + y]![left + x]).toBe(slot);
        }
      }),
    );
    expect(kept).toBeGreaterThan(0);
  });

  it("stamps only on sprite pixels when asked", () => {
    // Hull in the left half of the canvas only, and a hole at one cell the emblem would cover.
    const grid = blank(50, 50);
    for (let y = 0; y < 50; y += 1) {
      for (let x = 0; x < 25; x += 1) {
        grid[y]![x] = HULL;
      }
    }
    grid[25]![20] = null;
    const stamped = stampEmblem(grid, bitmap, { x: 25, y: 25 }, { onlyOn: silhouetteOf([grid]) });
    const written = stamped.flatMap((row, y) => row.map((slot, x) => ({ x, y, slot })).filter((cell) => cell.slot !== grid[cell.y]![cell.x]));
    expect(written.length).toBeGreaterThan(0);
    expect(written.every((cell) => cell.x < 25 && !(cell.x === 20 && cell.y === 25))).toBe(true);
    // Everything it did write is what the emblem has at that cell.
    const free = stampEmblem(blank(50, 50), bitmap, { x: 25, y: 25 });
    for (const cell of written) {
      expect(cell.slot).toBe(free[cell.y]![cell.x]);
    }
  });

  it("counts a pixel on any of the grids as sprite", () => {
    const one = blank(30, 30);
    const two = blank(30, 30);
    one[10]![10] = HULL;
    two[11]![10] = HULL;
    const onSprite = silhouetteOf([one, two, undefined]);
    expect(onSprite(10, 10)).toBe(true);
    expect(onSprite(10, 11)).toBe(true);
    expect(onSprite(11, 10)).toBe(false);
  });

  it("clips at the canvas edges without throwing", () => {
    const grid = blank(30, 30, HULL);
    for (const centre of [{ x: 0, y: 0 }, { x: 29, y: 29 }, { x: 0, y: 29 }, { x: -5, y: 15 }, { x: 15, y: 36 }]) {
      const stamped = stampEmblem(grid, bitmap, centre);
      expect(stamped.length).toBe(30);
      expect(stamped.every((row) => row.length === 30)).toBe(true);
      expect(stamped).not.toBe(grid);
    }
    const corner = stampEmblem(blank(30, 30), bitmap, { x: 0, y: 0 });
    for (let y = 0; y < 9; y += 1) {
      for (let x = 0; x < 9; x += 1) {
        expect(corner[y]![x]).toBe(bitmap[y + 8]![x + 8]);
      }
    }
  });

  it("returns the same grid when the emblem lands wholly off the canvas", () => {
    const grid = blank(30, 30, HULL);
    expect(stampEmblem(grid, bitmap, { x: 100, y: 100 })).toBe(grid);
    expect(stampEmblem(grid, bitmap, { x: -100, y: 5 })).toBe(grid);
    const empty = blank(30, 30);
    expect(stampEmblem(empty, bitmap, { x: 15, y: 15 }, { onlyOn: () => false })).toBe(empty);
  });

  it("gives the preview the cells the stamp writes", () => {
    const grid = blank(40, 40, HULL);
    const options = { onlyOn: (x: number) => x < 20 };
    const cells = emblemCells(bitmap, { x: 20, y: 20 }, { width: 40, height: 40 }, options);
    const stamped = stampEmblem(grid, bitmap, { x: 20, y: 20 }, options);
    for (const { x, y, slot } of cells) {
      expect(stamped[y]![x]).toBe(slot);
    }
    expect(cells.every((cell) => cell.x < 20)).toBe(true);
  });

  it("mirrors exactly when flipped", () => {
    for (const { emblem, size, bitmap: plain } of everyBitmap) {
      const flipped = emblemBitmap(emblem, size, true);
      expect(flipped.map((row) => row.slice().reverse()), `${emblem.id} ${size}`).toEqual(plain.map((row) => row.slice()));
      expect(opaque(flipped)).toBe(opaque(plain));
    }
  });

  it("refuses a size that is not drawn", () => {
    expect(() => emblemBitmap(star, 5)).toThrow();
  });

  it("stands on its side by swapping rows and columns", () => {
    for (const { emblem, size, bitmap: plain } of everyBitmap) {
      const turned = emblemBitmap(emblem, size, false, true);
      expect(turned.length, `${emblem.id} ${size}`).toBe(plain[0]!.length);
      expect(turned[0]!.length, `${emblem.id} ${size}`).toBe(plain.length);
      turned.forEach((row, y) => row.forEach((slot, x) => expect(slot).toBe(plain[x]![y])));
      expect(opaque(turned)).toBe(opaque(plain));
    }
  });

  it("keeps the light on the top left when turned, and flips the turned emblem when asked", () => {
    const red = (slot: string | null | undefined) => slot === "emblem_red" || slot === "emblem_red_light";
    for (const { emblem, size } of everyBitmap) {
      const turned = emblemBitmap(emblem, size, false, true);
      turned.forEach((row, y) =>
        row.forEach((slot, x) => {
          if (slot === "emblem_red_light") {
            expect(!(red(turned[y - 1]?.[x]) && red(row[x - 1])), `${emblem.id} ${size} turned, lit red at ${x}, ${y}`).toBe(true);
          }
        }),
      );
      const both = emblemBitmap(emblem, size, true, true);
      expect(both.map((row) => row.slice().reverse())).toEqual(turned.map((row) => row.slice()));
    }
  });
});

describe("German crosses and the extra markings", () => {
  it("keeps charcoal to the rim of the closed German cross", () => {
    for (const item of emblemById("ger_balkenkreuz")!.sizes) {
      const bitmap = emblemBitmap(emblemById("ger_balkenkreuz")!, item.size);
      bitmap.forEach((row, y) => {
        row.forEach((slot, x) => {
          if (slot !== "emblem_dark") {
            return;
          }
          const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (bitmap[y + dy]?.[x + dx] ?? null) === null);
          expect(edge, `${item.size} at ${x}, ${y}`).toBe(true);
        });
      });
    }
  });

  it("paints the German crosses in the highlight grey, not cream", () => {
    for (const id of ["ger_balkenkreuz", "ger_balkenkreuz_open"] as const) {
      for (const item of emblemById(id)!.sizes) {
        const slots = new Set(emblemBitmap(emblemById(id)!, item.size).flat());
        expect(slots.has("emblem_white"), `${id} ${item.size}`).toBe(false);
        expect(slots.has("emblem_white_shade"), `${id} ${item.size}`).toBe(true);
        expect(slots.has("emblem_grey"), `${id} ${item.size}`).toBe(true);
      }
    }
  });

  it("leaves two pixels of the open cross's arm ends bare", () => {
    for (const item of emblemById("ger_balkenkreuz_open")!.sizes) {
      const bitmap = emblemBitmap(emblemById("ger_balkenkreuz_open")!, item.size);
      const bare = (slot: string | null) => slot == null || slot === "emblem_dark";
      const n = bitmap.length;
      for (const y of [0, 1, n - 2, n - 1]) {
        expect(bitmap[y]!.every(bare), `${item.size} row ${y}`).toBe(true);
      }
      for (const row of bitmap) {
        for (const x of [0, 1, n - 2, n - 1]) {
          expect(bare(row[x] ?? null), `${item.size} column ${x}`).toBe(true);
        }
      }
    }
  });

  it("offers the extra markings by name", () => {
    expect(EMBLEMS.filter((emblem) => emblem.kind === "marking").map((emblem) => emblem.name)).toEqual([
      "Hinomaru, darker",
      "Open Balkenkreuz",
      "Bullet holes",
      "Barnacles",
      "Moss",
      "Tactical number",
      "Cargo",
      "Anchor",
      "Victory marks",
    ]);
  });
});

describe("sizes for the large sprites", () => {
  it("draws every emblem at 13, 17, 23, 31, 41 and 55 pixels", () => {
    for (const emblem of EMBLEMS) {
      expect(emblem.sizes.map((item) => item.size), emblem.id).toEqual([13, 17, 23, 31, 41, 55]);
    }
  });

  it("keeps the star and bars twice as wide as it is tall, less one, at every size", () => {
    const bars = emblemById("us_star_and_bars")!;
    for (const item of bars.sizes) {
      expect(item.width, `${item.size}`).toBe(item.height * 2 - 1);
    }
  });

  it("keeps the RAF roundel's red, white and blue at every large size", () => {
    for (const size of [41, 55]) {
      const slots = new Set(emblemBitmap(emblemById("uk_roundel_type_c")!, size).flat());
      for (const slot of ["emblem_red", "emblem_white", "emblem_blue", "emblem_dark"] as const) {
        expect(slots.has(slot), `${size} ${slot}`).toBe(true);
      }
    }
  });
});

describe("stamping on a sprite in the editor", () => {
  function tankWithHull() {
    let doc = withEditingLayer(blankDocument("USSR", "tank"), "hull");
    for (let y = 20; y < 36; y += 1) {
      for (let x = 8; x < 40; x += 1) {
        doc = paintAt(doc, x, y, "primary_uniform_or_hull");
      }
    }
    return doc;
  }

  it("writes the emblem on the open layer and into the flat frame", () => {
    const doc = tankWithHull();
    const bitmap = emblemBitmap(emblemById("ussr_red_star")!, 13);
    const stamped = stampEmblemAt(doc, bitmap, 24, 28, true);
    expect(stamped).not.toBe(doc);
    const onLayer = stamped.layers!.idle.hull!.flat().filter((slot) => slot === "emblem_red").length;
    const flat = stamped.blueprint.frames.idle.flat().filter((slot) => slot === "emblem_red").length;
    expect(onLayer).toBeGreaterThan(0);
    expect(flat).toBe(onLayer);
    expect(doc.layers!.idle.hull!.flat().some((slot) => slot === "emblem_red")).toBe(false);
  });

  it("stays on the hull when only-on-sprite is on, and spills when it is off", () => {
    const doc = tankWithHull();
    const bitmap = emblemBitmap(emblemById("ussr_red_star")!, 13);
    const nearEdge = stampEmblemAt(doc, bitmap, 8, 28, true);
    const hullCells = nearEdge.layers!.idle.hull!.flatMap((row, y) => row.map((slot, x) => ({ slot, x, y })).filter((cell) => cell.slot?.startsWith("emblem")));
    expect(hullCells.length).toBeGreaterThan(0);
    expect(hullCells.every((cell) => cell.x >= 8 && cell.y >= 20 && cell.y < 36)).toBe(true);
    const spilled = stampEmblemAt(doc, bitmap, 8, 28, false);
    const spilledCells = spilled.layers!.idle.hull!.flatMap((row, y) => row.map((slot, x) => ({ slot, x, y })).filter((cell) => cell.slot?.startsWith("emblem")));
    expect(spilledCells.some((cell) => cell.x < 8)).toBe(true);
    expect(stampPreviewCells(doc, bitmap, 8, 28, true).length).toBe(hullCells.length);
  });

  it("returns the document unchanged when no sprite is under the emblem", () => {
    const doc = tankWithHull();
    const bitmap = emblemBitmap(emblemById("jap_hinomaru")!, 13);
    expect(stampEmblemAt(doc, bitmap, 2, 2, true)).toBe(doc);
  });

  it("keeps the emblem red when the sprite is filed under another country", () => {
    const stamped = stampEmblemAt(tankWithHull(), emblemBitmap(emblemById("ussr_red_star")!, 13), 24, 28, true);
    const recoloured = { ...stamped, blueprint: { ...stamped.blueprint, factionId: "GER" as const } };
    const cell = recoloured.blueprint.frames.idle.flatMap((row, y) => row.map((slot, x) => ({ slot, x, y }))).find((item) => item.slot === "emblem_red")!;
    expect(slotHex(FACTION_MILITARY_MAPPINGS[recoloured.blueprint.factionId], cell.slot!)).toBe("#9C524E");
    expect(slotHex(FACTION_MILITARY_MAPPINGS.GER, "primary_uniform_or_hull")).not.toBe(slotHex(FACTION_MILITARY_MAPPINGS.USSR, "primary_uniform_or_hull"));
  });

  it("stamps on a flat frame when the unit has no layers", () => {
    const doc = { ...tankWithHull(), layers: null, editingLayer: null, flat: true };
    const stamped = stampEmblemAt(doc, emblemBitmap(emblemById("ger_balkenkreuz")!, 13), 24, 28, true);
    expect(stamped.blueprint.frames.idle.flat().some((slot) => slot === "emblem_dark")).toBe(true);
    expect(stamped.blueprint.frames.move_1).toBe(doc.blueprint.frames.move_1);
  });
});
