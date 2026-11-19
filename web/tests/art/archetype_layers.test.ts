import { describe, expect, it } from "vitest";
import {
  ARCHETYPES,
  ARCHETYPE_KEYS,
  ARCHETYPE_LAYERS,
  UNIT_TYPE_LABEL,
  archetypeForUnitType,
  buildAnimation,
  compositeStack,
  emptyFrames,
  emptyGrid,
  flattenFrames,
  shiftGrid,
  stepBlur,
  stepHighlights,
  waterlineFoam,
  type ArchetypeKey,
  type LayerFrames,
} from "../../src/art/archetypeLayers";
import { ARCHETYPE_STARTERS, archetypeStarter } from "../../src/art/archetypeStarters";
import { compileBlueprintFrame } from "../../src/art/blockoutCompiler";
import { buildMarch } from "../../src/art/infantryMarch";
import {
  ROSTER_FACTIONS,
  blankDocument,
  buildAnimationDocument,
  buildMarchDocument,
  documentFromBlueprint,
  duplicateLayerToNext,
  fromPaintFile,
  paintAt,
  starterBlueprints,
  starterDocument,
  toPaintFile,
  withEditingFrame,
  withEditingLayer,
  withFaction,
  withUnitType,
} from "../../src/art/pixelPaint";
import { FACTION_MILITARY_MAPPINGS, STARTER_BLUEPRINTS, STARTER_INFANTRY_LAYERS } from "../../src/art/starterParts";
import { SPRITE_FRAME_KEYS, type SpriteFrameGrid } from "../../src/art/skeletonSchema";
import { UNIT_DEFINITIONS } from "../../src/ui/battle/combatTypes";

const SIZE = 48;
const MOVES = ["move_1", "move_2", "fire"] as const;

type Offsets = Record<(typeof MOVES)[number], Record<string, [number, number]>>;

/** The table from the brief: where each layer sits on each pose, measured from idle. */
const OFFSETS: Record<Exclude<ArchetypeKey, "infantry">, Offsets> = {
  tank: {
    move_1: { tracks: [0, 0], hull: [0, 0], turret: [0, 0], barrel: [0, 0] },
    move_2: { tracks: [0, 0], hull: [0, 1], turret: [0, 1], barrel: [0, 1] },
    fire: { tracks: [0, 0], hull: [0, 1], turret: [-1, 1], barrel: [-2, 1] },
  },
  mech_infantry: {
    move_1: { wheels_tracks: [0, 0], chassis: [0, 0], crew_gun: [0, 0] },
    move_2: { wheels_tracks: [0, 0], chassis: [0, -1], crew_gun: [0, -1] },
    fire: { wheels_tracks: [0, 0], chassis: [0, 0], crew_gun: [-1, 0] },
  },
  artillery: {
    move_1: { carriage_wheels: [0, 0], gun_shield: [0, 0], barrel_breech: [0, 0] },
    move_2: { carriage_wheels: [0, 0], gun_shield: [0, 1], barrel_breech: [0, 1] },
    fire: { carriage_wheels: [-1, 0], gun_shield: [-1, 0], barrel_breech: [-2, 0] },
  },
  aircraft: {
    move_1: { fuselage_wings: [0, 0], engines_props: [0, 0], tail_markings: [0, 0] },
    move_2: { fuselage_wings: [0, 0], engines_props: [0, 1], tail_markings: [0, 0] },
    fire: { fuselage_wings: [-1, 0], engines_props: [-1, 0], tail_markings: [-1, 0] },
  },
  ship: {
    move_1: { hull_waterline: [0, 0], superstructure: [0, 0], turrets_masts: [0, 0] },
    move_2: { hull_waterline: [0, -1], superstructure: [0, -1], turrets_masts: [0, -1] },
    fire: { hull_waterline: [0, 1], superstructure: [0, 1], turrets_masts: [0, 1] },
  },
};

function find(grid: SpriteFrameGrid, slot: string): { x: number; y: number } {
  for (let y = 0; y < grid.length; y += 1) {
    const x = (grid[y] ?? []).indexOf(slot as never);
    if (x >= 0) {
      return { x, y };
    }
  }
  throw new Error(`missing ${slot}`);
}

function cells(grid: SpriteFrameGrid, slot?: string): string[] {
  const found: string[] = [];
  grid.forEach((row, y) =>
    row.forEach((cell, x) => {
      if (cell != null && (slot === undefined || cell === slot)) {
        found.push(`${x},${y}`);
      }
    }),
  );
  return found;
}

function bounds(grid: SpriteFrameGrid): { width: number; height: number; minX: number; maxX: number; minY: number; maxY: number } {
  let minX = SIZE;
  let minY = SIZE;
  let maxX = -1;
  let maxY = -1;
  grid.forEach((row, y) =>
    row.forEach((cell, x) => {
      if (cell != null) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }),
  );
  return { width: maxX - minX + 1, height: maxY - minY + 1, minX, maxX, minY, maxY };
}

/** One crimson pixel on each layer, well apart, on a block of hull colour so the layer has a body. */
function markedIdle(archetype: ArchetypeKey): LayerFrames {
  const frames = emptyFrames(archetype, SIZE, SIZE);
  ARCHETYPE_LAYERS[archetype].forEach((layer, index) => {
    const grid = frames.idle[layer];
    const y = 10 + index * 8;
    for (let x = 12; x <= 30; x += 1) {
      grid[y][x] = "primary_uniform_or_hull";
      grid[y + 1][x] = "primary_uniform_or_hull";
    }
    grid[y][20] = "insignia_accent";
  });
  return frames;
}

function starter(blueprintId: string) {
  const found = archetypeStarter(blueprintId);
  if (!found) {
    throw new Error(`no starter ${blueprintId}`);
  }
  return found;
}

describe("the six skeletons", () => {
  it("names six skeletons and stacks their layers bottom to top", () => {
    expect([...ARCHETYPE_KEYS]).toEqual(["infantry", "tank", "mech_infantry", "artillery", "aircraft", "ship"]);
    expect([...ARCHETYPE_LAYERS.infantry]).toEqual(["legs", "torso", "head", "hands_weapon"]);
    expect([...ARCHETYPE_LAYERS.tank]).toEqual(["tracks", "hull", "turret", "barrel"]);
    expect([...ARCHETYPE_LAYERS.mech_infantry]).toEqual(["wheels_tracks", "chassis", "crew_gun"]);
    expect([...ARCHETYPE_LAYERS.artillery]).toEqual(["carriage_wheels", "gun_shield", "barrel_breech"]);
    expect([...ARCHETYPE_LAYERS.aircraft]).toEqual(["fuselage_wings", "engines_props", "tail_markings"]);
    expect([...ARCHETYPE_LAYERS.ship]).toEqual(["hull_waterline", "superstructure", "turrets_masts"]);
    for (const key of ARCHETYPE_KEYS) {
      expect(ARCHETYPES[key].layers.map((layer) => layer.key)).toEqual([...ARCHETYPE_LAYERS[key]]);
      for (const layer of ARCHETYPES[key].layers) {
        expect(layer.label.length).toBeGreaterThan(0);
        expect(layer.hint.length).toBeGreaterThan(0);
      }
    }
  });

  it("gives every unit in the game a skeleton", () => {
    for (const unitType of Object.keys(UNIT_DEFINITIONS)) {
      expect(archetypeForUnitType(unitType), unitType).not.toBeNull();
    }
    expect(archetypeForUnitType("infantry")).toBe("infantry");
    expect(archetypeForUnitType("tank")).toBe("tank");
    expect(archetypeForUnitType("mech_infantry")).toBe("mech_infantry");
    expect(archetypeForUnitType("artillery")).toBe("artillery");
    expect(archetypeForUnitType("aaa")).toBe("artillery");
    for (const plane of ["fighter", "tactical_bomber", "strategic_bomber", "tac_bomber", "bomber"]) {
      expect(archetypeForUnitType(plane), plane).toBe("aircraft");
    }
    for (const hull of ["submarine", "transport", "destroyer", "cruiser", "carrier", "battleship"]) {
      expect(archetypeForUnitType(hull), hull).toBe("ship");
    }
    expect(archetypeForUnitType("zeppelin")).toBeNull();
  });

  it("offers the fourteen unit types, each one a real unit with the category of its skeleton", () => {
    const offered = Object.keys(UNIT_TYPE_LABEL);
    expect(offered).toHaveLength(14);
    for (const unitType of offered) {
      const definition = (UNIT_DEFINITIONS as Record<string, { category: string }>)[unitType];
      const archetype = archetypeForUnitType(unitType);
      expect(definition, unitType).toBeDefined();
      expect(archetype, unitType).not.toBeNull();
      expect(ARCHETYPES[archetype as ArchetypeKey].category, unitType).toBe(definition.category);
    }
  });
});

describe("Build Animation", () => {
  for (const archetype of Object.keys(OFFSETS) as Exclude<ArchetypeKey, "infantry">[]) {
    it(`moves each ${archetype} layer by the whole pixels in the brief`, () => {
      const source = markedIdle(archetype);
      const built = buildAnimation(archetype, source, { unitTypeId: ARCHETYPES[archetype].unitTypes[0], groundX: 24 });
      expect(built.idle).toEqual(source.idle);
      for (const pose of MOVES) {
        for (const layer of ARCHETYPE_LAYERS[archetype]) {
          const from = find(source.idle[layer], "insignia_accent");
          const [dx, dy] = OFFSETS[archetype][pose][layer];
          expect(find(built[pose][layer], "insignia_accent"), `${pose} ${layer}`).toEqual({ x: from.x + dx, y: from.y + dy });
        }
      }
    });
  }

  it("slides a flak gun's barrel back and down, and a field gun's straight back", () => {
    const source = markedIdle("artillery");
    const from = find(source.idle.barrel_breech, "insignia_accent");
    const field = buildAnimation("artillery", source, { unitTypeId: "artillery", groundX: 24 });
    expect(find(field.fire.barrel_breech, "insignia_accent")).toEqual({ x: from.x - 2, y: from.y });
    for (const flak of ["aaa", "aa"]) {
      const built = buildAnimation("artillery", source, { unitTypeId: flak, groundX: 24 });
      expect(find(built.fire.barrel_breech, "insignia_accent"), flak).toEqual({ x: from.x - 1, y: from.y + 1 });
      expect(find(built.fire.carriage_wheels, "insignia_accent"), flak).toEqual({
        x: find(source.idle.carriage_wheels, "insignia_accent").x - 1,
        y: find(source.idle.carriage_wheels, "insignia_accent").y,
      });
    }
  });

  it("rewrites the three poses from idle and never turns a pixel", () => {
    for (const archetype of Object.keys(OFFSETS) as Exclude<ArchetypeKey, "infantry">[]) {
      const source = markedIdle(archetype);
      const stale = emptyGrid(SIZE, SIZE);
      stale[2][2] = "wood_or_leather";
      const first = ARCHETYPE_LAYERS[archetype][0];
      source.move_1[first] = stale;
      source.fire[first] = stale;
      const built = buildAnimation(archetype, source, { unitTypeId: ARCHETYPES[archetype].unitTypes[0], groundX: 24 });
      for (const pose of MOVES) {
        expect(built[pose][first][2][2], `${archetype} ${pose}`).toBeNull();
        for (const layer of ARCHETYPE_LAYERS[archetype]) {
          // A shifted layer keeps its width and height. A turned one would not.
          const before = bounds(source.idle[layer]);
          const after = bounds(built[pose][layer]);
          if (layer === "hull_waterline") {
            continue;
          }
          expect([after.width, after.height], `${archetype} ${pose} ${layer}`).toEqual([before.width, before.height]);
        }
      }
    }
  });

  it("keeps the infantry march exactly as it was", () => {
    const layers = STARTER_INFANTRY_LAYERS.ger_infantry_43;
    expect(buildAnimation("infantry", layers, { unitTypeId: "infantry", groundX: 24 })).toEqual(buildMarch(layers, 24));
    const rifle = documentFromBlueprint(STARTER_BLUEPRINTS[0]);
    expect(rifle.archetype).toBe("infantry");
    expect(buildAnimationDocument(rifle).layers).toEqual(buildMarchDocument(rifle).layers);
    expect(buildAnimationDocument(rifle).blueprint.frames).toEqual(rifle.blueprint.frames);
  });
});

describe("alternate phases", () => {
  it("steps tread highlights one pixel along without changing the outline", () => {
    const row = (text: string) =>
      text
        .split("")
        .map((ch) =>
          ch === "M" ? "metallic_steel" : ch === "T" ? "metallic_brass_or_track" : ch === "P" ? "primary_uniform_or_hull" : null,
        );
    const text = (cells: (string | null)[]) =>
      cells
        .map((slot) =>
          slot === "metallic_steel" ? "M" : slot === "metallic_brass_or_track" ? "T" : slot === "primary_uniform_or_hull" ? "P" : ".",
        )
        .join("");
    const stepped = stepHighlights([row(".TMTMTMT."), row(".TMMPTTM."), row("..TTTTT.."), row("MTTTTTTT.")] as SpriteFrameGrid);
    expect(stepped.map(text)).toEqual([".TTMTMTM.", ".TPMMTTT.", "..TTTTT..", "TMTTTTTT."]);
  });

  it("gives the tank and the half-track a second tread phase on Move 1 only", () => {
    for (const [id, layer] of [
      ["ger_tank_pz4", "tracks"],
      ["ger_mech_infantry", "wheels_tracks"],
    ] as const) {
      const { layers } = starter(id);
      expect(layers.move_1[layer], id).not.toEqual(layers.idle[layer]);
      expect(cells(layers.move_1[layer]), id).toEqual(cells(layers.idle[layer]));
      expect(layers.move_1[layer], id).toEqual(stepHighlights(layers.idle[layer]));
      expect(layers.move_2[layer], id).toEqual(layers.idle[layer]);
      expect(layers.fire[layer], id).toEqual(layers.idle[layer]);
    }
  });

  it("keeps the fighter's propeller on its own layer", () => {
    const { layers } = starter("ger_fighter");
    const idle = layers.idle.engines_props;
    expect(cells(idle).length).toBeGreaterThan(0);
    // This propeller is not drawn in steel, so the steel-step leaves it as it is. The banking shift still moves it.
    expect(layers.move_1.engines_props).toEqual(stepBlur(idle));
    expect(layers.move_1.engines_props).toEqual(idle);
    expect(layers.move_1.fuselage_wings).toEqual(layers.idle.fuselage_wings);
    expect(layers.move_2.engines_props).toEqual(shiftGrid(idle, 0, 1));
    expect(layers.move_2.fuselage_wings).toEqual(layers.idle.fuselage_wings);
  });

  it("puts foam on the waterline at bow and stern, in a different pattern on each step", () => {
    const { layers } = starter("ger_destroyer");
    const hull = layers.idle.hull_waterline;
    const waterline = bounds(hull).maxY;
    const row = hull[waterline];
    const stern = row.findIndex((slot) => slot != null);
    const bow = row.length - 1 - [...row].reverse().findIndex((slot) => slot != null);
    const foamAt = (grid: SpriteFrameGrid, y: number, xs: number[]) => xs.every((x) => grid[y]?.[x] === "skin_stand_in");
    expect(layers.move_1.hull_waterline).toEqual(waterlineFoam(hull, 0));
    expect(foamAt(layers.move_1.hull_waterline, waterline, [stern - 1, stern + 1, bow - 1, bow + 1])).toBe(true);
    expect(layers.move_2.hull_waterline).toEqual(shiftGrid(waterlineFoam(hull, 1), 0, -1));
    expect(foamAt(layers.move_2.hull_waterline, waterline - 1, [stern, stern + 2, bow - 2, bow])).toBe(true);
    expect(layers.fire.hull_waterline).toEqual(shiftGrid(hull, 0, 1));
  });
});

describe("muzzle flash", () => {
  it("paints the flash on the recoiled gun tip, only when the muzzle is marked", () => {
    for (const [id, layer] of [
      ["ger_tank_pz4", "barrel"],
      ["ger_fighter", "engines_props"],
      ["ger_destroyer", "turrets_masts"],
    ] as const) {
      const found = starter(id);
      const muzzle = found.blueprint.muzzlePoint;
      if (!muzzle) {
        throw new Error(`${id} has no muzzle`);
      }
      const [dx, dy] = OFFSETS[found.archetype as Exclude<ArchetypeKey, "infantry">].fire[layer];
      const fire = found.layers.fire[layer];
      expect(found.layers.idle[layer][muzzle.y][muzzle.x], id).not.toBeNull();
      expect(fire[muzzle.y + dy][muzzle.x + dx + 1], id).toBe("skin_stand_in");
      expect(fire[muzzle.y + dy][muzzle.x + dx + 2], id).toBe("skin_stand_in");
      expect(fire[muzzle.y + dy - 1][muzzle.x + dx + 1], id).toBe("insignia_accent");
      expect(fire[muzzle.y + dy + 1][muzzle.x + dx + 1], id).toBe("insignia_accent");
      const unmarked = buildAnimation(found.archetype, found.layers, { unitTypeId: found.blueprint.unitTypeId, groundX: 24 });
      expect(unmarked.fire[layer], id).toEqual(shiftGrid(found.layers.idle[layer], dx, dy));
    }
  });

  it("fires a gun from each wing of the fighter", () => {
    const { layers, blueprint } = starter("ger_fighter");
    const nose = blueprint.muzzlePoint ?? { x: 0, y: 0 };
    const flashes = cells(layers.fire.engines_props, "skin_stand_in").map((cell) => Number(cell.split(",")[1]));
    expect(flashes.some((y) => y < nose.y - 3)).toBe(true);
    expect(flashes.some((y) => y > nose.y + 3)).toBe(true);
  });

  it("leaves the half-track and the howitzer to the runtime flash", () => {
    for (const id of ["ger_mech_infantry", "ger_artillery"]) {
      const found = starter(id);
      const top = ARCHETYPE_LAYERS[found.archetype][2];
      const [dx, dy] = OFFSETS[found.archetype as Exclude<ArchetypeKey, "infantry">].fire[top];
      expect(found.layers.fire[top], id).toEqual(shiftGrid(found.layers.idle[top], dx, dy));
      expect(found.blueprint.muzzlePoint, id).toBeDefined();
    }
  });
});

describe("layered starters", () => {
  it("seeds a German candidate sprite for every unit type except infantry", () => {
    expect(ARCHETYPE_STARTERS.map((item) => item.blueprint.blueprintId).slice(0, 13)).toEqual([
      "ger_tank_pz4",
      "ger_mech_infantry",
      "ger_artillery",
      "ger_aaa",
      "ger_fighter",
      "ger_tac_bomber",
      "ger_bomber",
      "ger_submarine",
      "ger_transport",
      "ger_destroyer",
      "ger_cruiser",
      "ger_carrier",
      "ger_battleship",
    ]);
    const outlined = ARCHETYPE_STARTERS.slice(13).map((item) => item.blueprint.blueprintId);
    expect(outlined).toEqual(expect.arrayContaining(["uk_tank_cromwell", "us_tank_sherman", "ussr_tank_t34"]));
    expect(outlined.some((id) => id.includes("infantry_43"))).toBe(false);
    expect(ARCHETYPE_STARTERS.slice(0, 13).map((item) => item.archetype)).toEqual([
      "tank",
      "mech_infantry",
      "artillery",
      "artillery",
      "aircraft",
      "aircraft",
      "aircraft",
      "ship",
      "ship",
      "ship",
      "ship",
      "ship",
      "ship",
    ]);
    for (const item of ARCHETYPE_STARTERS) {
      expect(archetypeForUnitType(item.blueprint.unitTypeId), item.title).toBe(item.archetype);
      expect(item.blueprint.category, item.title).toBe(ARCHETYPES[item.archetype].category);
      expect(Object.keys(item.layers.idle), item.title).toEqual([...ARCHETYPE_LAYERS[item.archetype]]);
      for (const layer of ARCHETYPE_LAYERS[item.archetype]) {
        expect(cells(item.layers.idle[layer]).length, `${item.title} ${layer}`).toBeGreaterThan(0);
      }
    }
  });

  it("hands the game four flat poses and nothing about layers", () => {
    for (const item of ARCHETYPE_STARTERS) {
      expect(Object.keys(item.blueprint.frames).sort(), item.title).toEqual([...SPRITE_FRAME_KEYS].sort());
      expect(item.blueprint.frames, item.title).toEqual(flattenFrames(item.archetype, item.layers));
      expect(item.blueprint.frames.idle, item.title).toEqual(compositeStack(item.archetype, item.layers.idle));
      expect("layers" in item.blueprint, item.title).toBe(false);
      for (const pose of MOVES) {
        // A gun on its carriage does not march: the brief keeps every artillery layer still on Move 1.
        // A propeller that is not painted in steel has nothing to step, so that Move 1 matches Idle too.
        const gear =
          item.archetype === "tank" ? item.layers.idle.tracks : item.archetype === "mech_infantry" ? item.layers.idle.wheels_tracks : null;
        const still =
          (item.archetype === "artillery" && pose === "move_1") ||
          (item.archetype === "aircraft" &&
            pose === "move_1" &&
            stepBlur(item.layers.idle.engines_props).every((row, y) =>
              row.every((slot, x) => slot === item.layers.idle.engines_props[y][x]),
            )) ||
          (gear != null && pose === "move_1" && stepHighlights(gear).every((row, y) => row.every((slot, x) => slot === gear[y][x])));
        if (still) {
          expect(item.blueprint.frames[pose], item.title).toEqual(item.blueprint.frames.idle);
          continue;
        }
        expect(item.blueprint.frames[pose], `${item.title} ${pose}`).not.toEqual(item.blueprint.frames.idle);
      }
    }
  });

  it("fits the 80 by 56 sheet with its ink margin, on every pose, in every country's colours", () => {
    for (const item of ARCHETYPE_STARTERS) {
      for (const faction of ROSTER_FACTIONS) {
        const recoloured = withFaction(starterDocument(item.blueprint.blueprintId)!, faction);
        for (const pose of SPRITE_FRAME_KEYS) {
          const compiled = compileBlueprintFrame(recoloured.blueprint, pose, FACTION_MILITARY_MAPPINGS[faction]);
          expect(compiled.sheetBlitOffset, `${item.title} ${faction} ${pose}`).toEqual({ x: 16, y: 7 });
          const used = new Set(compiled.albedoKeys.filter((key) => key != null));
          for (const key of used) {
            expect(Object.values(FACTION_MILITARY_MAPPINGS[faction]), `${item.title} ${faction} ${pose}`).toContain(key);
          }
        }
        expect(recoloured.blueprint.frames, `${item.title} ${faction}`).toEqual(item.blueprint.frames);
      }
    }
  });

  it("draws each class inside its footprint beside the 26-pixel rifleman", () => {
    const rifleman = bounds(STARTER_BLUEPRINTS[0].frames.idle);
    expect(rifleman.height).toBe(26);
    expect(rifleman.height).toBeLessThanOrEqual(ARCHETYPES.infantry.footprint.height);
    for (const item of ARCHETYPE_STARTERS) {
      const drawn = bounds(item.blueprint.frames.idle);
      const { width, height } = ARCHETYPES[item.archetype].footprint;
      expect(drawn.width, item.title).toBeLessThanOrEqual(width);
      expect(drawn.height, item.title).toBeLessThanOrEqual(height);
      // Land units and ships stand on the rifleman's ground row.
      if (item.archetype !== "aircraft") {
        expect(drawn.maxY, item.title).toBe(rifleman.maxY);
      }
    }
  });

  it("keeps the destroyer's hull to 46 pixels so the foam and the outline stay on the sheet", () => {
    const { layers } = starter("ger_destroyer");
    expect(ARCHETYPES.ship.footprint.width).toBe(46);
    expect(bounds(layers.idle.hull_waterline).width).toBeLessThanOrEqual(46);
    for (const pose of SPRITE_FRAME_KEYS) {
      const hull = bounds(layers[pose].hull_waterline);
      expect(hull.minX, pose).toBeGreaterThanOrEqual(0);
      expect(hull.maxX, pose).toBeLessThanOrEqual(47);
    }
    // A hull that fills all 46 pixels at the waterline still keeps its foam on the canvas.
    const full = emptyGrid(SIZE, SIZE);
    for (let x = 1; x <= 46; x += 1) {
      full[45][x] = "primary_uniform_or_hull";
    }
    expect(cells(waterlineFoam(full, 0), "skin_stand_in").sort()).toEqual(["0,45", "2,45", "45,45", "47,45"].sort());
  });
});

describe("painting any skeleton", () => {
  it("lists the riflemen, the candidate sprites, and the tanks that have no outlined picture", () => {
    const ids = starterBlueprints().map((item) => item.blueprintId);
    const layered = new Set(ARCHETYPE_STARTERS.map((item) => item.blueprint.blueprintId));
    const flatTanks = STARTER_BLUEPRINTS.filter((item) => item.unitTypeId !== "infantry" && !layered.has(item.blueprintId));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(6 + ARCHETYPE_STARTERS.length + flatTanks.length);
    expect(ids.slice(0, 6).every((id) => id.includes("_infantry_"))).toBe(true);
    expect(ids.slice(6, 6 + ARCHETYPE_STARTERS.length)).toEqual(ARCHETYPE_STARTERS.map((item) => item.blueprint.blueprintId));
    expect(flatTanks.map((item) => item.blueprintId)).toEqual(["jap_tank_chi_ha", "minor_tank_lt38"]);
    expect(STARTER_BLUEPRINTS).toHaveLength(12);
  });

  it("opens the layered Panzer from the list and leaves the flat one as it was", () => {
    const layered = starterDocument("ger_tank_pz4");
    expect(layered?.archetype).toBe("tank");
    expect(layered?.editingLayer).toBe("tracks");
    expect(Object.keys(layered?.layers?.idle ?? {})).toEqual(["tracks", "hull", "turret", "barrel"]);
    const flat = documentFromBlueprint(STARTER_BLUEPRINTS.find((item) => item.blueprintId === "ger_tank_pz4")!);
    expect(flat.layers).toBeNull();
    expect(flat.editingLayer).toBeNull();
    expect(flat.archetype).toBe("tank");
    expect(starterDocument("ussr_tank_t34")?.archetype).toBe("tank");
    expect(starterDocument("ussr_tank_t34")?.editingLayer).toBe("tracks");
    const flatT34 = documentFromBlueprint(STARTER_BLUEPRINTS.find((item) => item.blueprintId === "ussr_tank_t34")!);
    expect(flatT34.layers).toBeNull();
    expect(starterDocument("ger_infantry_43")?.archetype).toBe("infantry");
    expect(starterDocument("nobody")).toBeNull();
  });

  it("paints one layer, erases through all of them, and refuses another skeleton's layer", () => {
    const ship = starterDocument("ger_destroyer")!;
    expect(withEditingLayer(ship, "turret")).toBe(ship);
    const masts = withEditingLayer(ship, "turrets_masts");
    expect(masts.editingLayer).toBe("turrets_masts");
    const painted = paintAt(masts, 20, 10, "insignia_accent");
    expect(painted.layers?.idle.turrets_masts[10][20]).toBe("insignia_accent");
    expect(painted.layers?.idle.hull_waterline).toEqual(ship.layers?.idle.hull_waterline);
    expect(painted.blueprint.frames.idle[10][20]).toBe("insignia_accent");
    expect(ship.blueprint.frames.idle[10][20]).toBeNull();
    const hullCell = { x: 20, y: 43 };
    const erased = paintAt(painted, hullCell.x, hullCell.y, "eraser");
    for (const layer of ARCHETYPE_LAYERS.ship) {
      expect(erased.layers?.idle[layer][hullCell.y][hullCell.x], layer).toBeNull();
    }
    expect(erased.blueprint.frames.idle[hullCell.y][hullCell.x]).toBeNull();
  });

  it("copies one layer to the next pose and leaves the others there", () => {
    const tank = withEditingLayer(starterDocument("ger_tank_pz4")!, "turret");
    const painted = paintAt(tank, 5, 5, "insignia_accent");
    const copied = duplicateLayerToNext(painted);
    expect(copied.editingFrame).toBe("move_1");
    expect(copied.layers?.move_1.turret).toEqual(painted.layers?.idle.turret);
    expect(copied.layers?.move_1.tracks).toEqual(tank.layers?.move_1.tracks);
    expect(copied.layers?.move_1.barrel).toEqual(tank.layers?.move_1.barrel);
    expect(copied.blueprint.frames.move_1[5][5]).toBe("insignia_accent");
  });

  it("rebuilds the animation from an edited idle", () => {
    const tank = withEditingLayer(starterDocument("ger_tank_pz4")!, "hull");
    const painted = paintAt(tank, 10, 20, "insignia_accent");
    expect(painted.blueprint.frames.move_2[21][10]).toBeNull();
    const built = buildAnimationDocument(withEditingFrame(painted, "fire"));
    expect(built.editingFrame).toBe("fire");
    expect(built.layers?.move_1.hull[20][10]).toBe("insignia_accent");
    expect(built.layers?.move_2.hull[21][10]).toBe("insignia_accent");
    expect(built.layers?.fire.hull[21][10]).toBe("insignia_accent");
    expect(built.blueprint.frames).toEqual(flattenFrames("tank", built.layers!));
    expect(buildMarchDocument(painted)).toBe(painted);
  });

  it("starts an empty sprite on any skeleton", () => {
    const rifleman = blankDocument("GER");
    expect(rifleman.archetype).toBe("infantry");
    expect(rifleman.editingLayer).toBe("legs");
    expect(rifleman.blueprint.unitTypeId).toBe("infantry");
    expect(rifleman.blueprint.muzzlePoint).toEqual({ x: 36, y: 24 });
    const bomber = blankDocument("UK", "aircraft", "strategic_bomber");
    expect(bomber.blueprint.unitTypeId).toBe("strategic_bomber");
    expect(bomber.blueprint.category).toBe("air");
    expect(bomber.blueprint.factionId).toBe("UK");
    expect(bomber.editingLayer).toBe("fuselage_wings");
    expect(Object.keys(bomber.layers?.fire ?? {})).toEqual(["fuselage_wings", "engines_props", "tail_markings"]);
    expect(cells(bomber.blueprint.frames.idle)).toEqual([]);
    expect(blankDocument("US", "ship").blueprint.unitTypeId).toBe("submarine");
    expect(blankDocument("US", "ship", "tank").blueprint.unitTypeId).toBe("submarine");
    expect(blankDocument("US", "ship").blueprint.category).toBe("sea");
  });

  it("changes the unit type inside a skeleton without losing the drawing", () => {
    const howitzer = starterDocument("ger_artillery")!;
    const flak = withUnitType(howitzer, "aaa");
    expect(flak.archetype).toBe("artillery");
    expect(flak.blueprint.unitTypeId).toBe("aaa");
    expect(flak.layers).toEqual(howitzer.layers);
    const idle = flak.layers!.idle.barrel_breech;
    expect(buildAnimationDocument(flak).layers?.fire.barrel_breech).toEqual(shiftGrid(idle, -1, 1));
    expect(buildAnimationDocument(howitzer).layers?.fire.barrel_breech).toEqual(shiftGrid(idle, -2, 0));
    const cruiser = withUnitType(howitzer, "cruiser");
    expect(cruiser.archetype).toBe("ship");
    expect(cruiser.blueprint.unitTypeId).toBe("cruiser");
    expect(cruiser.blueprint.factionId).toBe("GER");
    expect(cells(cruiser.blueprint.frames.idle)).toEqual([]);
    expect(withUnitType(howitzer, "artillery")).toBe(howitzer);
    expect(withUnitType(howitzer, "zeppelin")).toBe(howitzer);
  });

  it("saves and opens a layered unit of any skeleton", () => {
    for (const item of ARCHETYPE_STARTERS) {
      const doc = withEditingLayer(starterDocument(item.blueprint.blueprintId)!, ARCHETYPE_LAYERS[item.archetype][1]);
      const file = JSON.parse(JSON.stringify(toPaintFile(doc)));
      expect(file.archetype, item.title).toBe(item.archetype);
      const opened = fromPaintFile(file);
      expect(opened.archetype, item.title).toBe(item.archetype);
      expect(opened.editingLayer, item.title).toBe(ARCHETYPE_LAYERS[item.archetype][1]);
      expect(opened.layers, item.title).toEqual(doc.layers);
      expect(opened.blueprint.frames, item.title).toEqual(doc.blueprint.frames);
    }
  });

  it("opens a file from before the other skeletons as a rifleman", () => {
    const rifle = documentFromBlueprint(STARTER_BLUEPRINTS[0]);
    const file = JSON.parse(JSON.stringify(toPaintFile(rifle)));
    delete file.archetype;
    const opened = fromPaintFile(file);
    expect(opened.archetype).toBe("infantry");
    expect(opened.editingLayer).toBe("legs");
    expect(opened.layers).toEqual(rifle.layers);
  });

  it("refuses a file whose layers belong to another skeleton", () => {
    const rifle = JSON.parse(JSON.stringify(toPaintFile(documentFromBlueprint(STARTER_BLUEPRINTS[0]))));
    rifle.archetype = "tank";
    expect(() => fromPaintFile(rifle)).toThrow(/tracks layer/);
  });
});
