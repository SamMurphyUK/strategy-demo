import {
  buildMarch,
  emptyLayerStack,
  framesFromLayers,
  type InfantryLayerFrames,
} from "./infantryMarch";
import type {
  FactionMilitaryMapping,
  PaletteSlotKey,
  RosterFactionId,
  SpriteFrameGrid,
  SpriteFrameKey,
  UnitSpriteSheetBlueprint,
} from "./skeletonSchema";

/**
 * Exact mappings from semantic PaletteSlotKey to the 16 named MILITARY strip keys:
 * cream, tan, terracotta, crimson, plum, charcoal, steel, spruce,
 * sage, taupe, feldgrau, bone, olive, brass, brown, khaki.
 */
export const FACTION_MILITARY_MAPPINGS: Record<RosterFactionId, FactionMilitaryMapping> = {
  GER: {
    primary_uniform_or_hull: "feldgrau",
    secondary_trim_or_webbing: "charcoal",
    metallic_steel: "steel",
    metallic_brass_or_track: "charcoal",
    wood_or_leather: "brown",
    skin_stand_in: "bone",
    insignia_accent: "crimson",
  },
  USSR: {
    primary_uniform_or_hull: "crimson",
    secondary_trim_or_webbing: "tan",
    metallic_steel: "steel",
    metallic_brass_or_track: "charcoal",
    wood_or_leather: "brown",
    skin_stand_in: "bone",
    insignia_accent: "brass",
  },
  UK: {
    primary_uniform_or_hull: "khaki",
    secondary_trim_or_webbing: "taupe",
    metallic_steel: "steel",
    metallic_brass_or_track: "charcoal",
    wood_or_leather: "brown",
    skin_stand_in: "bone",
    insignia_accent: "crimson",
  },
  US: {
    primary_uniform_or_hull: "olive",
    secondary_trim_or_webbing: "khaki",
    metallic_steel: "steel",
    metallic_brass_or_track: "charcoal",
    wood_or_leather: "brown",
    skin_stand_in: "tan",
    insignia_accent: "cream",
  },
  JAP: {
    primary_uniform_or_hull: "terracotta",
    secondary_trim_or_webbing: "khaki",
    metallic_steel: "steel",
    metallic_brass_or_track: "charcoal",
    wood_or_leather: "brown",
    skin_stand_in: "tan",
    insignia_accent: "crimson",
  },
  MINOR: {
    primary_uniform_or_hull: "sage",
    secondary_trim_or_webbing: "spruce",
    metallic_steel: "steel",
    metallic_brass_or_track: "taupe",
    wood_or_leather: "brown",
    skin_stand_in: "bone",
    insignia_accent: "plum",
  },
};

/** Compact ASCII glyph legend for authoring readable pixel matrices. */
const GLYPH_TO_SLOT: Record<string, PaletteSlotKey | null> = {
  ".": null,
  P: "primary_uniform_or_hull",
  S: "secondary_trim_or_webbing",
  M: "metallic_steel",
  T: "metallic_brass_or_track",
  W: "wood_or_leather",
  K: "skin_stand_in",
  I: "insignia_accent",
};

export function parseGrid(rows: string[]): (PaletteSlotKey | null)[][] {
  return rows.map((row) =>
    row.split("").map((ch) => {
      if (!(ch in GLYPH_TO_SLOT)) {
        throw new Error(`Unknown pixel grid glyph "${ch}"`);
      }
      return GLYPH_TO_SLOT[ch];
    }),
  );
}

function authoredPart(
  partId: string,
  slotType: string,
  label: string,
  localPivot: { x: number; y: number },
  rows: string[],
) {
  const width = rows[0]?.length ?? 0;
  if (width === 0 || rows.some((row) => row.length !== width)) {
    throw new Error(`${partId} has uneven rows`);
  }
  return {
    partId,
    slotType,
    label,
    width,
    height: rows.length,
    localPivot,
    pixelGrid: parseGrid(rows),
    promptFragment: "wool trousers and leather boots, both toes pointing right",
  };
}

// ============================================================================
// STARTER PART ASSETS (Flat Albedo — #1A1614 outline added by figureGround.ts)
// ============================================================================

const SOURCE_PARTS = {
  // --- INFANTRY PARTS (Native Facing: Right) ---
  // Both boots keep the toe on the right. Reach lifts the trailing boot.
  // Pass brings the feet together and lifts one. Plant is the idle stance.
  inf_legs_plant: authoredPart("inf_legs_plant", "legs", "Planted boots, toes right", { x: 5, y: 10 }, [
    "..PPPPPP...",
    "..PPPPPP...",
    "..PP..PP...",
    ".PP....PP..",
    ".PP....PP..",
    ".SS....SS..",
    ".SS....SS..",
    "..WW..WW...",
    "..WWW.WWW..",
    "..WWW.WWWW.",
    "..WWW.WWWW.",
  ]),
  inf_legs_reach: authoredPart("inf_legs_reach", "legs", "Reaching step, toes right", { x: 5, y: 10 }, [
    "..PPPPPP....",
    "..PPPPPP....",
    "..PP...PP...",
    ".PP....PPP..",
    ".PP....PPP..",
    ".SS....SS...",
    ".SS...SSS...",
    "..WW...WWW..",
    "..WWW..WWW..",
    "..WWW...WWW.",
    ".......WWWW.",
  ]),
  inf_legs_pass: authoredPart("inf_legs_pass", "legs", "Passing step, toes right", { x: 5, y: 10 }, [
    "...PPPP....",
    "...PPPP....",
    "..PPPPPP...",
    "..PP..PP...",
    "..SS..SS...",
    "..SS..SS...",
    "...W..WW...",
    "...WW.WWW..",
    "...WW.WWW..",
    "...WW..WW..",
    "......WWW..",
  ]),

  inf_torso_tunic: {
    partId: "inf_torso_tunic",
    slotType: "torso",
    label: "Infantry Field Tunic & Webbing",
    width: 10,
    height: 10,
    localPivot: { x: 5, y: 9 },
    pixelGrid: parseGrid([
      "..PPPPPP..",
      ".PPPPPPPP.",
      ".PPSSSPPP.",
      ".PPSSSPPP.",
      ".PPPPPPPP.",
      ".PPPPPPPP.",
      "SSSSSSSSSS",
      "SSSWWWWSSS",
      ".PPPPPPPP.",
      ".PPPPPPPP.",
    ]),
    promptFragment: "buttoned field tunic, cross-strap webbing, ammunition pouches",
  },

  inf_head_stahlhelm: {
    partId: "inf_head_stahlhelm",
    slotType: "head",
    label: "Stahlhelm & Face",
    width: 9,
    height: 8,
    localPivot: { x: 4, y: 7 },
    pixelGrid: parseGrid([
      "..PPPPP..",
      ".PPPPPPP.",
      "PPPPPPPPP",
      "PPPPPPPPP",
      ".KKKKKK..",
      ".KKKKKKK.",
      "..KKKKK..",
      "...KKK...",
    ]),
    promptFragment: "flared steel M35 stahlhelm helmet",
  },

  inf_head_brodie: {
    partId: "inf_head_brodie",
    slotType: "head",
    label: "Brodie Helmet & Face",
    width: 11,
    height: 8,
    localPivot: { x: 5, y: 7 },
    pixelGrid: parseGrid([
      "...PPPPP...",
      "..PPPPPPP..",
      "PPPPPPPPPPP",
      "..KKKKKK...",
      "..KKKKKKK..",
      "...KKKKK...",
      "....KKK....",
      "...........",
    ]),
    promptFragment: "wide-brimmed British Brodie steel helmet",
  },

  inf_head_ssh40: {
    partId: "inf_head_ssh40",
    slotType: "head",
    label: "SSh-40 Helmet & Red Star",
    width: 9,
    height: 8,
    localPivot: { x: 4, y: 7 },
    pixelGrid: parseGrid([
      "..PPPPP..",
      ".PPP.PPP.",
      ".PPPIPPP.",
      "PPPPPPPP.",
      ".KKKKKK..",
      ".KKKKKKK.",
      "..KKKKK..",
      "...KKK...",
    ]),
    promptFragment: "rounded Soviet SSh-40 helmet with red star insignia",
  },

  inf_head_type90: {
    partId: "inf_head_type90",
    slotType: "head",
    label: "Type 90 Cap & Neck Flaps",
    width: 9,
    height: 8,
    localPivot: { x: 4, y: 7 },
    pixelGrid: parseGrid([
      "..PPPPP..",
      ".PPPPPPP.",
      "PPPPPPPPP",
      "PPKKKKK..",
      "PPKKKKKK.",
      "PP.KKKK..",
      "...KKK...",
      ".........",
    ]),
    promptFragment: "Imperial Japanese Type 90 helmet with cloth havelock neck flaps",
  },

  inf_arms_rifle_ready: {
    partId: "inf_arms_rifle_ready",
    slotType: "weapon",
    label: "Arms & Bolt-Action Rifle",
    width: 18,
    height: 7,
    localPivot: { x: 5, y: 3 },
    pixelGrid: parseGrid([
      ".............MMMMM",
      "..........WWWWMMMM",
      "....PP..WWWWWW....",
      "..PPPPWWWWWW......",
      ".PPPKKWWWW........",
      ".PPPKK............",
      "..................",
    ]),
    promptFragment: "wooden bolt-action service rifle held across chest at ready angle",
  },

  // --- TANK PARTS (Native Facing: Right) ---
  tank_tracks_standard: {
    partId: "tank_tracks_standard",
    slotType: "chassis",
    label: "Armoured Treads & Road Wheels",
    width: 34,
    height: 8,
    localPivot: { x: 17, y: 7 },
    pixelGrid: parseGrid([
      "..TTTTTTTTTTTTTTTTTTTTTTTTTTTTTT..",
      ".TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT.",
      "TTMMTTMMTTMMTTMMTTMMTTMMTTMMTTMMTT",
      "TTMMTTMMTTMMTTMMTTMMTTMMTTMMTTMMTT",
      "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT",
      ".TTMMTTMMTTMMTTMMTTMMTTMMTTMMTTMM.",
      "..TTTTTTTTTTTTTTTTTTTTTTTTTTTTTT..",
      "...TTTTTTTTTTTTTTTTTTTTTTTTTTTT...",
    ]),
    promptFragment: "heavy steel caterpillar tracks with bogie road wheels",
  },

  tank_hull_box: {
    partId: "tank_hull_box",
    slotType: "hull",
    label: "Angular Medium Tank Hull (GER/UK)",
    width: 32,
    height: 8,
    localPivot: { x: 16, y: 7 },
    pixelGrid: parseGrid([
      "....PPPPPPPPPPPPPPPPPPPPPPPP....",
      "..PPPPPPPPPPPPPPPPPPPPPPPPPPPP..",
      ".PPPPIIPPPPPPPPPPPPPPPPPPPPPPPP.",
      "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP",
      "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP",
      "SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS",
      "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP",
      ".PPPPPPPPPPPPPPPPPPPPPPPPPPPPPP.",
    ]),
    promptFragment: "riveted sloped steel hull with side skirts and hull machine gun port",
  },

  tank_hull_sloped: {
    partId: "tank_hull_sloped",
    slotType: "hull",
    label: "Sloped Glacis Hull (USSR/US/JAP)",
    width: 32,
    height: 8,
    localPivot: { x: 16, y: 7 },
    pixelGrid: parseGrid([
      ".....PPPPPPPPPPPPPPPPPPPPPP.....",
      "...PPPPPPPPPPPPPPPPPPPPPPPPPP...",
      "..PPPPIIPPPPPPPPPPPPPPPPPPPPPP..",
      ".PPPPPPPPPPPPPPPPPPPPPPPPPPPPPP.",
      "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP",
      "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP",
      "SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS",
      ".PPPPPPPPPPPPPPPPPPPPPPPPPPPPPP.",
    ]),
    promptFragment: "cast sloped glacis armour hull with external fuel drums",
  },

  tank_turret_medium: {
    partId: "tank_turret_medium",
    slotType: "turret",
    label: "Medium Tank Turret & Cupola",
    width: 16,
    height: 7,
    localPivot: { x: 8, y: 6 },
    pixelGrid: parseGrid([
      "...PPPPPP.......",
      "..PPPPPPPP......",
      ".PPPPPPPPPPPP...",
      "PPPPPPPPPPPPPP..",
      "PPPPIIPPPPPPPPP.",
      "PPPPPPPPPPPPPPP.",
      ".PPPPPPPPPPPPP..",
    ]),
    promptFragment: "commander cupola hatch and welded steel gun turret",
  },

  tank_barrel_75mm: {
    partId: "tank_barrel_75mm",
    slotType: "barrel",
    label: "75mm Tank Gun Barrel & Muzzle Brake",
    width: 15,
    height: 3,
    localPivot: { x: 0, y: 1 },
    pixelGrid: parseGrid([
      "PP...........MM",
      "PPMMMMMMMMMMMMM",
      "PP...........MM",
    ]),
    promptFragment: "long 75mm high-velocity tank cannon barrel with slotted muzzle brake",
  },
};

const CANVAS = 48;
const GROUND = { x: 24, y: 45 };

interface Stamp {
  partId: keyof typeof SOURCE_PARTS;
  pivotX: number;
  pivotY: number;
}

function emptyGrid(): SpriteFrameGrid {
  return Array.from({ length: CANVAS }, () => Array.from({ length: CANVAS }, () => null));
}

function stamp(grid: SpriteFrameGrid, item: Stamp): void {
  const part = SOURCE_PARTS[item.partId];
  for (let y = 0; y < part.height; y++) {
    for (let x = 0; x < part.width; x++) {
      const slot = part.pixelGrid[y]?.[x];
      if (slot == null) {
        continue;
      }
      const destX = item.pivotX + (x - part.localPivot.x);
      const destY = item.pivotY + (y - part.localPivot.y);
      if (destX < 0 || destY < 0 || destX >= CANVAS || destY >= CANVAS) {
        continue;
      }
      const row = grid[destY];
      if (row) {
        row[destX] = slot;
      }
    }
  }
}

function composite(stamps: Stamp[]): SpriteFrameGrid {
  const grid = emptyGrid();
  for (const item of stamps) {
    stamp(grid, item);
  }
  return grid;
}

function stampPart(partId: keyof typeof SOURCE_PARTS, pivotX: number, pivotY: number): SpriteFrameGrid {
  const grid = emptyGrid();
  stamp(grid, { partId, pivotX, pivotY });
  return grid;
}

function infantryLayers(headPartId: keyof typeof SOURCE_PARTS): InfantryLayerFrames {
  const idle = {
    legs: stampPart("inf_legs_plant", GROUND.x, GROUND.y),
    torso: stampPart("inf_torso_tunic", GROUND.x, GROUND.y - 9),
    head: stampPart(headPartId, GROUND.x, GROUND.y - 18),
    hands_weapon: stampPart("inf_arms_rifle_ready", GROUND.x - 1, GROUND.y - 15),
  };
  return buildMarch(
    {
      idle,
      move_1: { ...emptyLayerStack(CANVAS, CANVAS), legs: stampPart("inf_legs_reach", GROUND.x, GROUND.y) },
      move_2: { ...emptyLayerStack(CANVAS, CANVAS), legs: stampPart("inf_legs_pass", GROUND.x, GROUND.y) },
      fire: emptyLayerStack(CANVAS, CANVAS),
    },
    GROUND.x,
  );
}

function tankStamps(hullPartId: keyof typeof SOURCE_PARTS): Stamp[] {
  return [
    { partId: "tank_tracks_standard", pivotX: GROUND.x, pivotY: GROUND.y },
    { partId: hullPartId, pivotX: GROUND.x, pivotY: GROUND.y - 6 },
    { partId: "tank_barrel_75mm", pivotX: GROUND.x + 5, pivotY: GROUND.y - 16 },
    { partId: "tank_turret_medium", pivotX: GROUND.x - 1, pivotY: GROUND.y - 13 },
  ];
}

function movePixels(
  source: SpriteFrameGrid,
  place: (x: number, y: number, slot: PaletteSlotKey) => { x: number; y: number },
): SpriteFrameGrid {
  const next = emptyGrid();
  for (let y = 0; y < CANVAS; y++) {
    for (let x = 0; x < CANVAS; x++) {
      const slot = source[y]?.[x];
      if (slot == null) {
        continue;
      }
      const dest = place(x, y, slot);
      if (dest.x < 0 || dest.y < 0 || dest.x >= CANVAS || dest.y >= CANVAS) {
        continue;
      }
      const row = next[dest.y];
      if (row) {
        row[dest.x] = slot;
      }
    }
  }
  return next;
}

function tankFrames(hullPartId: keyof typeof SOURCE_PARTS): Record<SpriteFrameKey, SpriteFrameGrid> {
  const idle = composite(tankStamps(hullPartId));
  return {
    idle,
    move_1: movePixels(idle, (x, y, slot) => ({ x: x + (slot === "metallic_brass_or_track" ? 1 : 0), y })),
    move_2: movePixels(idle, (x, y) => ({ x, y: y + 1 })),
    fire: movePixels(idle, (x, y, slot) => ({ x: x - (slot === "metallic_steel" ? 2 : 0), y })),
  };
}

function makeSheet(
  blueprintId: string,
  factionId: RosterFactionId,
  unitTypeId: "infantry" | "tank",
  frames: Record<SpriteFrameKey, SpriteFrameGrid>,
  historicalEraTag: string,
  muzzlePoint: { x: number; y: number },
): UnitSpriteSheetBlueprint {
  return {
    blueprintId,
    unitTypeId,
    factionId,
    category: "land",
    canvasSize: { width: CANVAS, height: CANVAS },
    groundOrigin: { ...GROUND },
    sheetFootAnchor: { x: 40, y: 52 },
    muzzlePoint,
    nativeFacing: "right",
    recoilOffsetPx: unitTypeId === "tank" ? 2 : 1,
    frames,
    historicalEraTag,
  };
}

export const STARTER_INFANTRY_LAYERS: Record<string, InfantryLayerFrames> = {};

function makeInfantry(
  blueprintId: string,
  factionId: RosterFactionId,
  headPartId: keyof typeof SOURCE_PARTS,
  historicalEraTag: string,
): UnitSpriteSheetBlueprint {
  const layers = infantryLayers(headPartId);
  STARTER_INFANTRY_LAYERS[blueprintId] = layers;
  return makeSheet(blueprintId, factionId, "infantry", framesFromLayers(layers), historicalEraTag, { x: 36, y: 24 });
}

export const STARTER_BLUEPRINTS: UnitSpriteSheetBlueprint[] = [
  makeInfantry("ger_infantry_43", "GER", "inf_head_stahlhelm", "1943 Wehrmacht Heer infantryman"),
  makeInfantry("ussr_infantry_43", "USSR", "inf_head_ssh40", "1943 Red Army rifleman"),
  makeInfantry("uk_infantry_43", "UK", "inf_head_brodie", "1943 British Commonwealth infantryman"),
  makeInfantry("us_infantry_43", "US", "inf_head_brodie", "1943 US Army GI rifleman"),
  makeInfantry("jap_infantry_43", "JAP", "inf_head_type90", "1943 Imperial Japanese Army rifleman"),
  makeInfantry("minor_infantry_43", "MINOR", "inf_head_brodie", "1943 Allied/Axis minor power infantryman"),
  makeSheet("ger_tank_pz4", "GER", "tank", tankFrames("tank_hull_box"), "1943 German Panzer IV Ausf. H medium tank", { x: 44, y: 27 }),
  makeSheet("ussr_tank_t34", "USSR", "tank", tankFrames("tank_hull_sloped"), "1943 Soviet T-34/76 medium tank", { x: 44, y: 27 }),
  makeSheet("uk_tank_cromwell", "UK", "tank", tankFrames("tank_hull_box"), "1944 British Cromwell Mk IV cruiser tank", { x: 44, y: 27 }),
  makeSheet("us_tank_sherman", "US", "tank", tankFrames("tank_hull_sloped"), "1943 US M4A1 Sherman medium tank", { x: 44, y: 27 }),
  makeSheet("jap_tank_chi_ha", "JAP", "tank", tankFrames("tank_hull_sloped"), "1943 Japanese Type 97 Chi-Ha Kai medium tank", { x: 44, y: 27 }),
  makeSheet("minor_tank_lt38", "MINOR", "tank", tankFrames("tank_hull_box"), "1942 European light-medium tank", { x: 44, y: 27 }),
];
