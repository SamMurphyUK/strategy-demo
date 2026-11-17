import type {
  FactionMilitaryMapping,
  PaletteSlotKey,
  PartAsset,
  RosterFactionId,
  UnitSkeletonBlueprint,
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

function parseGrid(rows: string[]): (PaletteSlotKey | null)[][] {
  return rows.map((row) =>
    row.split("").map((ch) => {
      if (!(ch in GLYPH_TO_SLOT)) {
        throw new Error(`Unknown pixel grid glyph "${ch}"`);
      }
      return GLYPH_TO_SLOT[ch];
    }),
  );
}

// ============================================================================
// STARTER PART ASSETS (Flat Albedo — #1A1614 outline added by figureGround.ts)
// ============================================================================

export const STARTER_PARTS: Record<string, PartAsset> = {
  // --- INFANTRY PARTS (Native Facing: Right) ---
  inf_legs_stride: {
    partId: "inf_legs_stride",
    slotType: "legs",
    label: "Infantry Stride Legs & Boots",
    width: 10,
    height: 11,
    localPivot: { x: 5, y: 10 },
    pixelGrid: parseGrid([
      "..PPPPPP..",
      "..PPPPPP..",
      "..PP..PP..",
      ".PP....PP.",
      ".PP....PP.",
      ".SS....SS.",
      ".SS....SS.",
      ".WW....WW.",
      ".WW....WW.",
      "WWW....WWW",
      "WWW....WWW",
    ]),
    promptFragment: "wool trousers, puttees, leather combat boots in marching stance",
  },

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

// ============================================================================
// STARTER UNIT SKELETON BLUEPRINTS (Fits 80x56 Sheet at Foot Anchor 40, 52)
// ============================================================================

function makeInfantryBlueprint(
  blueprintId: string,
  factionId: RosterFactionId,
  headPartId: string,
  historicalEraTag: string,
): UnitSkeletonBlueprint {
  return {
    blueprintId,
    unitTypeId: "infantry",
    factionId,
    category: "land",
    canvasSize: { width: 48, height: 48 },
    // Feet at (24, 45) leave two canvas rows under the boots. On the 80×56 sheet that is y=52, with room for the ink ring.
    groundOrigin: { x: 24, y: 45 },
    sheetFootAnchor: { x: 40, y: 52 },
    muzzlePoint: { x: 36, y: 24 },
    nativeFacing: "right",
    historicalEraTag,
    nodes: [
      {
        nodeId: "legs",
        partId: "inf_legs_stride",
        parentId: null,
        anchorInParent: { x: 0, y: 0 },
        rotationDeg: 0,
        zIndex: 10,
      },
      {
        nodeId: "torso",
        partId: "inf_torso_tunic",
        parentId: "legs",
        anchorInParent: { x: 0, y: -9 },
        rotationDeg: 0,
        zIndex: 20,
      },
      {
        nodeId: "head",
        partId: headPartId,
        parentId: "torso",
        anchorInParent: { x: 0, y: -9 },
        rotationDeg: 0,
        zIndex: 30,
      },
      {
        nodeId: "weapon",
        partId: "inf_arms_rifle_ready",
        parentId: "torso",
        anchorInParent: { x: -1, y: -6 },
        rotationDeg: 0,
        zIndex: 40,
      },
    ],
  };
}

function makeTankBlueprint(
  blueprintId: string,
  factionId: RosterFactionId,
  hullPartId: string,
  historicalEraTag: string,
): UnitSkeletonBlueprint {
  return {
    blueprintId,
    unitTypeId: "tank",
    factionId,
    category: "land",
    canvasSize: { width: 48, height: 48 },
    // Treads rest at y=45, so they land on sheet y=52. The barrel stays inside the sheet's right margin.
    groundOrigin: { x: 24, y: 45 },
    sheetFootAnchor: { x: 40, y: 52 },
    muzzlePoint: { x: 44, y: 27 },
    nativeFacing: "right",
    historicalEraTag,
    nodes: [
      {
        nodeId: "tracks",
        partId: "tank_tracks_standard",
        parentId: null,
        anchorInParent: { x: 0, y: 0 },
        rotationDeg: 0,
        zIndex: 10,
      },
      {
        nodeId: "hull",
        partId: hullPartId,
        parentId: "tracks",
        anchorInParent: { x: 0, y: -6 },
        rotationDeg: 0,
        zIndex: 20,
      },
      {
        nodeId: "turret",
        partId: "tank_turret_medium",
        parentId: "hull",
        anchorInParent: { x: -1, y: -7 },
        rotationDeg: 0,
        zIndex: 30,
        articulation: {
          role: "turret",
          pivotOffset: { x: 0, y: 0 },
          minDeg: 0,
          maxDeg: 0,
          recoilPx: 0,
        },
      },
      {
        nodeId: "barrel",
        partId: "tank_barrel_75mm",
        parentId: "turret",
        anchorInParent: { x: 6, y: -3 },
        rotationDeg: 0,
        zIndex: 25,
        articulation: {
          role: "barrel",
          pivotOffset: { x: 0, y: 0 },
          minDeg: -12,
          maxDeg: 5,
          recoilPx: 3,
        },
      },
    ],
  };
}

export const STARTER_BLUEPRINTS: UnitSkeletonBlueprint[] = [
  makeInfantryBlueprint("ger_infantry_43", "GER", "inf_head_stahlhelm", "1943 Wehrmacht Heer infantryman"),
  makeInfantryBlueprint("ussr_infantry_43", "USSR", "inf_head_ssh40", "1943 Red Army rifleman"),
  makeInfantryBlueprint("uk_infantry_43", "UK", "inf_head_brodie", "1943 British Commonwealth infantryman"),
  makeInfantryBlueprint("us_infantry_43", "US", "inf_head_brodie", "1943 US Army GI rifleman"),
  makeInfantryBlueprint("jap_infantry_43", "JAP", "inf_head_type90", "1943 Imperial Japanese Army rifleman"),
  makeInfantryBlueprint("minor_infantry_43", "MINOR", "inf_head_brodie", "1943 Allied/Axis minor power infantryman"),

  makeTankBlueprint("ger_tank_pz4", "GER", "tank_hull_box", "1943 German Panzer IV Ausf. H medium tank"),
  makeTankBlueprint("ussr_tank_t34", "USSR", "tank_hull_sloped", "1943 Soviet T-34/76 medium tank"),
  makeTankBlueprint("uk_tank_cromwell", "UK", "tank_hull_box", "1944 British Cromwell Mk IV cruiser tank"),
  makeTankBlueprint("us_tank_sherman", "US", "tank_hull_sloped", "1943 US M4A1 Sherman medium tank"),
  makeTankBlueprint("jap_tank_chi_ha", "JAP", "tank_hull_sloped", "1943 Japanese Type 97 Chi-Ha Kai medium tank"),
  makeTankBlueprint("minor_tank_lt38", "MINOR", "tank_hull_box", "1942 European light-medium tank"),
];
