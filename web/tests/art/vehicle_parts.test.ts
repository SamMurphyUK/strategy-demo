import { describe, expect, it } from "vitest";
import { PART_LAYERS } from "../../dev/bakeUnitPlugin.mjs";
import { ARCHETYPE_LAYERS, compositeStack, emptyGrid } from "../../src/art/archetypeLayers";
import { fromLayeredFile, toLayeredFile } from "../../src/art/layeredUnit";
import { starterDocument, withFaction, type UnitPaintDocument } from "../../src/art/pixelPaint";
import type { PaletteSlotKey, SpriteFrameGrid } from "../../src/art/skeletonSchema";
import {
  addVehiclePart,
  copyVehiclePart,
  gridFromPicture,
  hasParts,
  partPreview,
  partsOnLayer,
  removeVehiclePart,
  renameVehiclePart,
  saveVehicleBuild,
  vehicleBuildGaps,
  wardrobeOf,
  wearVehicleBuild,
  wearVehiclePart,
  wornVehicleBuild,
  wornVehiclePart,
} from "../../src/art/vehicleParts";
import { TANK_PARTS, boxPicture, tankPlate } from "./plateFixture";

/** A grid the size of the canvas with one solid block of a slot. */
function block(doc: UnitPaintDocument, slot: PaletteSlotKey, x0: number, y0: number, w: number, h: number): SpriteFrameGrid {
  const { width, height } = doc.blueprint.canvasSize;
  const grid = emptyGrid(width, height);
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      grid[y]![x] = slot;
    }
  }
  return grid;
}

describe("the parts of a layered vehicle", () => {
  it("starts each layer with one part: its drawing, named for the layer", () => {
    const doc = tankPlate();
    const wardrobe = wardrobeOf(doc);
    expect(wardrobe.parts.map((part) => part.id)).toEqual(["tracks_original", "hull_original", "turret_original", "barrel_original"]);
    expect(wardrobe.parts.map((part) => part.name)).toEqual(["Original tracks", "Original hull", "Original turret", "Original barrel"]);
    expect(wardrobe.wearing).toEqual({ tracks: "tracks_original", hull: "hull_original", turret: "turret_original", barrel: "barrel_original" });
    expect(wornVehiclePart(doc, "hull").grid).toEqual(doc.layers!.idle.hull);
    expect(wardrobe.builds).toEqual([]);
  });

  it("is for layered vehicles, aircraft, and ships, including the 48-pixel ones, and not for riflemen", () => {
    expect(hasParts(tankPlate())).toBe(true);
    expect(hasParts(starterDocument("ger_tank_pz4")!)).toBe(true);
    expect(hasParts(starterDocument("ger_infantry_43")!)).toBe(false);
  });

  it("adds a part to a layer and wears it, with the old one still in the library", () => {
    const doc = tankPlate();
    const gun = block(doc, "metallic_steel", 80, 2, 20, 4);
    const next = addVehiclePart(doc, "turret", "Long gun", gun);
    expect(partsOnLayer(next, "turret").map((part) => part.name)).toEqual(["Original turret", "Long gun"]);
    expect(wornVehiclePart(next, "turret").name).toBe("Long gun");
    expect(next.layers!.idle.turret).toEqual(gun);
    expect(partPreview(next, "turret", gun)).toEqual(compositeStack("tank", next.layers!.idle));
  });

  it("swaps the worn part back and forth without losing either drawing", () => {
    const doc = addVehiclePart(tankPlate(), "turret", "Long gun", block(tankPlate(), "metallic_steel", 80, 2, 20, 4));
    const original = wardrobeOf(doc).parts.find((part) => part.id === "turret_original")!;
    const back = wearVehiclePart(doc, "turret", "turret_original");
    expect(wornVehiclePart(back, "turret").id).toBe("turret_original");
    expect(back.layers!.idle.turret).toEqual(original.grid);
    expect(wearVehiclePart(back, "turret", "turret_long_gun").layers!.idle.turret).toEqual(doc.layers!.idle.turret);
    expect(wearVehiclePart(back, "turret", "turret_original")).toBe(back);
  });

  it("refuses to wear a part that belongs to another layer", () => {
    const doc = tankPlate();
    expect(() => wearVehiclePart(doc, "hull", "turret_original")).toThrow(/has no part/);
  });

  it("refuses a drawing that is not the size of the canvas, a name in use, and a layer the skeleton does not have", () => {
    const doc = tankPlate();
    expect(() => addVehiclePart(doc, "hull", "Small", emptyGrid(4, 4))).toThrow(/canvas is/);
    const gun = block(doc, "metallic_steel", 80, 2, 20, 4);
    const next = addVehiclePart(doc, "turret", "Long gun", gun);
    expect(() => addVehiclePart(next, "turret", "long GUN", gun)).toThrow(/already has a part/);
    expect(() => addVehiclePart(doc, "wheels", "Wheel", gun)).toThrow(/not a layer/);
    expect(() => addVehiclePart(doc, "hull", "   ", gun)).toThrow(/Give the part a name/);
  });

  it("copies the worn part under a new name and wears the copy, so the first stays as it was", () => {
    const doc = tankPlate();
    const copy = copyVehiclePart(doc, "hull", "Hull copy");
    expect(partsOnLayer(copy, "hull").map((part) => part.name)).toEqual(["Original hull", "Hull copy"]);
    expect(wornVehiclePart(copy, "hull").name).toBe("Hull copy");
    expect(wornVehiclePart(copy, "hull").grid).toEqual(doc.layers!.idle.hull);
    expect(wardrobeOf(copy).parts.find((part) => part.id === "hull_original")!.grid).toEqual(doc.layers!.idle.hull);
  });

  it("renames a part, and refuses a name another part on the layer already has", () => {
    const doc = addVehiclePart(tankPlate(), "turret", "Long gun", block(tankPlate(), "metallic_steel", 80, 2, 20, 4));
    const renamed = renameVehiclePart(doc, "turret_long_gun", "Rail gun");
    expect(wardrobeOf(renamed).parts.find((part) => part.id === "turret_long_gun")!.name).toBe("Rail gun");
    expect(() => renameVehiclePart(doc, "turret_long_gun", "Original turret")).toThrow(/already has a part/);
  });

  it("hands the worn layer to its neighbour when the worn part is deleted, and keeps a layer's last part", () => {
    const doc = addVehiclePart(tankPlate(), "turret", "Long gun", block(tankPlate(), "metallic_steel", 80, 2, 20, 4));
    const removed = removeVehiclePart(doc, "turret_long_gun");
    expect(wornVehiclePart(removed, "turret").id).toBe("turret_original");
    expect(removed.layers!.idle.turret).toEqual(wardrobeOf(doc).parts.find((part) => part.id === "turret_original")!.grid);
    expect(() => removeVehiclePart(tankPlate(), "hull_original")).toThrow(/needs one part/);
  });

  it("saves a build of what every layer wears and its colours, and reports it as the one that is on", () => {
    const standard = saveVehicleBuild(tankPlate(), "Standard");
    const [build] = wardrobeOf(standard).builds;
    expect(wardrobeOf(standard).builds.map((item) => item.name)).toEqual(["Standard"]);
    expect(build!.colours).toBe("UK");
    expect(wornVehicleBuild(standard)?.id).toBe(build!.id);

    const swapped = addVehiclePart(standard, "turret", "Long gun", block(standard, "metallic_steel", 80, 2, 20, 4));
    expect(wornVehicleBuild(swapped)).toBeNull();
    const longer = saveVehicleBuild(swapped, "Long");
    expect(wardrobeOf(longer).builds.map((item) => item.name)).toEqual(["Standard", "Long"]);
    // A name in use is saved over, keeping its place and its id.
    const overwritten = saveVehicleBuild(longer, "standard");
    expect(wardrobeOf(overwritten).builds.map((item) => item.id)).toEqual(wardrobeOf(longer).builds.map((item) => item.id));
    // It saves what is worn now, so the long gun is what the build holds.
    expect(wardrobeOf(overwritten).builds[0]!.wearing.turret).toBe("turret_long_gun");
  });

  it("wears a saved build: its parts come back, and its colours come with it", () => {
    const standard = saveVehicleBuild(tankPlate(), "Standard");
    const id = wardrobeOf(standard).builds[0]!.id;
    const swapped = addVehiclePart(standard, "turret", "Long gun", block(standard, "metallic_steel", 80, 2, 20, 4));
    const back = wearVehicleBuild(swapped, id);
    expect(wornVehiclePart(back, "turret").id).toBe("turret_original");
    expect(back.layers!.idle.turret).toEqual(standard.layers!.idle.turret);
    const recoloured = wearVehicleBuild(withFaction(swapped, "GER"), id);
    expect(recoloured.blueprint.factionId).toBe("UK");
  });

  it("names the layers whose part a build no longer has", () => {
    let doc = saveVehicleBuild(tankPlate(), "Standard");
    const build = wardrobeOf(doc).builds[0]!;
    expect(vehicleBuildGaps(doc, build)).toEqual([]);
    doc = addVehiclePart(doc, "hull", "Hull two", block(doc, "primary_uniform_or_hull", 0, 12, 108, 12));
    doc = removeVehiclePart(doc, "hull_original");
    expect(vehicleBuildGaps(doc, build)).toEqual(["hull"]);
  });

  it("reads a picture the size of the canvas into the country's seven slots, and leaves clear pixels empty", () => {
    const doc = tankPlate();
    const { width, height } = doc.blueprint.canvasSize;
    const picture = boxPicture("UK", width, height, [{ slot: "metallic_steel", x: 0, y: 0, w: 2, h: 2 }]);
    const grid = gridFromPicture(doc, picture.rgba, width, height);
    expect(grid[0]![0]).toBe("metallic_steel");
    expect(grid[0]![1]).toBe("metallic_steel");
    expect(grid[5]![5]).toBeNull();
    expect(() => gridFromPicture(doc, picture.rgba, 10, 10)).toThrow(/A part is the size of the canvas/);
  });

  it("writes parts to the layered file only once there is a library, and reads them back", () => {
    expect(toLayeredFile(tankPlate())).not.toHaveProperty("parts");

    const gun = block(tankPlate(), "metallic_steel", 80, 2, 20, 4);
    const doc = saveVehicleBuild(addVehiclePart(tankPlate(), "turret", "Long gun", gun), "Long");
    const file = JSON.parse(JSON.stringify(toLayeredFile(doc))) as ReturnType<typeof toLayeredFile>;
    const worn = file.parts!.find((part) => part.id === "turret_long_gun")!;
    const spare = file.parts!.find((part) => part.id === "turret_original")!;
    expect(worn.rows).toBeUndefined();
    expect(spare.rows).toHaveLength(doc.blueprint.canvasSize.height);
    expect(file.wearing!.turret).toBe("turret_long_gun");
    expect(file.builds).toHaveLength(1);

    const back = fromLayeredFile(file);
    expect(wardrobeOf(back)).toEqual(wardrobeOf(doc));
    expect(back.layers!.idle.turret).toEqual(gun);
  });

  it("keeps the dev route's part layers the same as the skeletons in archetypeLayers", () => {
    // The four infantry layers are the rig's categories. The rest are the vehicle, aircraft, and ship skeletons.
    const infantry = ["legs", "torso", "head", "weapon"];
    const vehicles = Object.entries(ARCHETYPE_LAYERS)
      .filter(([key]) => key !== "infantry")
      .flatMap(([, layers]) => layers);
    expect([...PART_LAYERS].sort()).toEqual([...new Set([...infantry, ...vehicles])].sort());
  });
});
