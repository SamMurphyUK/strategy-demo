import {
  buildAnimation,
  emptyGrid,
  flattenFrames,
  emptyFrames,
  type ArchetypeKey,
  type LayerFrames,
  type LayerStack,
} from "./archetypeLayers";
import { parseGrid } from "./starterParts";
import { SHEET_FOOT_ANCHOR } from "./skeletonSchema";
import type { SpriteFrameGrid, UnitCategory, UnitSpriteSheetBlueprint, Vec2 } from "./skeletonSchema";

/**
 * One layered starter for each skeleton that is not infantry. They are drawn in the German list and
 * recolour for every country, like the riflemen.
 *
 * Glyphs: . empty, P hull, S trim, M steel, T track, W leather, K skin, I insignia.
 * Everything faces right. Running gear stands on row 45. Only the idle is drawn here. Build Animation
 * writes the other three poses.
 */
const CANVAS = 48;
const GROUND: Vec2 = { x: 24, y: 45 };

interface Piece {
  x: number;
  y: number;
  rows: string[];
}

function piece(x: number, y: number, rows: string[]): Piece {
  const width = rows[0]?.length ?? 0;
  if (width === 0 || rows.some((row) => row.length !== width)) {
    throw new Error(`A starter piece at ${x}, ${y} has uneven rows`);
  }
  return { x, y, rows };
}

/** Paint pieces onto one 48×48 layer, later pieces over earlier ones. */
function layerOf(...pieces: Piece[]): SpriteFrameGrid {
  const grid = emptyGrid(CANVAS, CANVAS);
  for (const item of pieces) {
    const cells = parseGrid(item.rows);
    cells.forEach((row, dy) => {
      row.forEach((slot, dx) => {
        const target = grid[item.y + dy];
        if (slot == null) {
          return;
        }
        if (!target || item.x + dx < 0 || item.x + dx >= CANVAS) {
          throw new Error(`A starter piece at ${item.x}, ${item.y} leaves the canvas`);
        }
        target[item.x + dx] = slot;
      });
    });
  }
  return grid;
}

/** The lower half of a plane seen from above is the upper half, mirrored about its last row. */
function mirrored(rows: string[]): string[] {
  return [...rows, ...rows.slice(0, -1).reverse()];
}

// ---------------------------------------------------------------------------------------------
// Panzer IV Ausf. H. 44 wide, 24 tall.
// ---------------------------------------------------------------------------------------------

const PZ4: LayerStack = {
  // Eight road wheels in hull colour inside the tread. Steel links crawl along both runs.
  tracks: layerOf(
    piece(3, 38, [
      "..TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT..",
      ".TMTMTMTMTMTMTMTMTMTMTMTMTMTMTMTMTMTT.",
      "TPPTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTPPT",
      "TPPTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTPPT",
      "TTTTPPTTPPTTPPTTPPTTPPTTPPTTPPTTPPTTTT",
      ".TTTPPTTPPTTPPTTPPTTPPTTPPTTPPTTPPTTT.",
      "..TMTTMTTMTTMTTMTTMTTMTTMTTMTTMTTMTT..",
      "...TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT...",
    ]),
  ),
  // Superstructure, the fender line, and four skirt plates over the upper run.
  hull: layerOf(
    piece(2, 31, [
      "....PPPPPPPPPPPPPPPPPPPPPPPPPPPP........",
      "...PPPPPPPPPPPPPPPPPPPPPPPPPPPPPP.......",
      "..SPPPPPPPPPPPIPPPPPPPPPPPPPPPPPPPP.....",
      "..SPPPPPPPPPPIIIPPPPPPPPPPPPPPPPPPPPP...",
      ".PPPPPPPPPPPPPIPPPPPPPPPPPPPPPPPPPPPPPP.",
      "SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS",
      ".PPPPPPSPPPPPPSPPPPPPSPPPPPPSPPPPPP.....",
      ".PPPPPPSPPPPPPSPPPPPPSPPPPPPSPPPPPP.....",
      ".PPPPPPSPPPPPPSPPPPPPSPPPPPPSPPPPPP.....",
    ]),
  ),
  // Skirted turret with the cupola at the back and the mantlet at the front.
  turret: layerOf(
    piece(11, 22, [
      "....SSSSS..........",
      "....PPPPP..........",
      "..PPPPPPPPPPPPPP...",
      ".PPPPPPPPPPPPPPPP..",
      "PPPPPSPPPPPPSPPPPP.",
      "PPPPPSPPPPPPSPPPPPS",
      "PPPPPSPPPPPPSPPPPPS",
      "PPPPPSPPPPPPSPPPPP.",
      ".SSSSSSSSSSSSSSSS..",
    ]),
  ),
  // 7.5 cm gun: sleeve, tube, and the muzzle brake.
  barrel: layerOf(piece(30, 26, ["SS...........MM.", "SSMMMMMMMMMMMMMM", "SS...........MM."])),
};

// ---------------------------------------------------------------------------------------------
// Sd.Kfz. 251 half-track. 41 wide, 23 tall with the crew.
// ---------------------------------------------------------------------------------------------

const SDKFZ251: LayerStack = {
  // Interleaved road wheels inside the rear track, and the front tyre with a glint on the hub.
  wheels_tracks: layerOf(
    piece(5, 38, [
      "..TTTTTTTTTTTTTTTTTTT..",
      ".TMTMTMTMTMTMTMTMTMTMT.",
      "TTPPPTPPPTPPPTPPPTPPPTT",
      "TPPSPPPSPPPSPPPSPPPSPPT",
      "TPPSPPPSPPPSPPPSPPPSPPT",
      "TTPPPTPPPTPPPTPPPTPPPTT",
      ".TMTTMTTMTTMTTMTTMTTMT.",
      "..TTTTTTTTTTTTTTTTTTT..",
    ]),
    piece(34, 38, ["..TTTT..", ".TTTTTT.", "TTPPPPTT", "TTPMSPTT", "TTPSSPTT", "TTPPPPTT", ".TTTTTT.", "..TTTT.."]),
  ),
  // Open crew compartment at the back, the long bonnet, and the crease along the side.
  chassis: layerOf(
    piece(3, 27, [
      ".....PPPPPPPPPPPPPPPPPPPPP...............",
      "....PPPPPPPPPPPPPPPPPPPPPPP..............",
      "...PPPPPPPPPPPPPPPPPPPPPPPPP.............",
      "..PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP....",
      ".PPPPPPPPIPPPPPPPPPPPPPSSPPPPPPPPPPPPPP..",
      "PPPPPPPPIIIPPPPPPPPPPPPPPPPPPPPPPPPPPPPP.",
      "SSSSSSSSSISSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS",
      ".PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP",
      "..PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP.",
      "...PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP..",
      "..SSSSSSSSSSSSSSSSSSSSSSSS.....SSSSSSSS..",
      ".........................SSSSSS..........",
    ]),
  ),
  // Two helmets above the armour, and the shielded machine gun over the cab.
  crew_gun: layerOf(
    piece(11, 23, ["..............SS.......", ".PPP....PPP.WWSSMMMMMMM", "PPPP...PPPP...SS.......", ".KK.....KK....SS......."]),
  ),
};

// ---------------------------------------------------------------------------------------------
// 10.5 cm leFH 18 field howitzer. 42 wide, 21 tall.
// ---------------------------------------------------------------------------------------------

const LEFH18: LayerStack = {
  // The trail runs back to its spade. The wheel is painted over the axle end.
  carriage_wheels: layerOf(
    piece(2, 40, [
      "..............PPPPPPP",
      "...........PPPPPPP...",
      "........PPPPPPP......",
      ".....PPPPPPP.........",
      "..SPPPPPP............",
      "SSSSS................",
    ]),
    piece(21, 34, [
      "....TTTT....",
      "..TTPPPPTT..",
      ".TPPPPPPPPT.",
      ".TPPPSSPPPT.",
      "TPPPSSSSPPPT",
      "TPPSSSSSSPPT",
      "TPPSSSSSSPPT",
      "TPPPSSSSPPPT",
      ".TPPPSSPPPT.",
      ".TPPPPPPPPT.",
      "..TTPPPPTT..",
      "....TTTT....",
    ]),
  ),
  // The shield leans back at the top. The recoil cradle runs under the barrel.
  gun_shield: layerOf(
    piece(23, 32, ["PPPPPPPPPPPPPPPPP", ".SSSSSSSSSSSSSS.."]),
    piece(25, 25, [
      "PPPS..",
      "PPPS..",
      ".PPPS.",
      "..PPPS",
      "..PPPS",
      "..PPPS",
      "..PPPS",
      "..PPPS",
      "..PPPS",
      "..PPPS",
      "..PPPS",
      "..PPPS",
      "..PPPS",
    ]),
  ),
  // Breech block and the tube, through the shield. The lower row is the tube's shadow.
  barrel_breech: layerOf(
    piece(17, 29, [
      "SSSSSS.....................",
      "SSSSSSMMMMMMMMMMMMMMMMMMMMM",
      "SSSSSSSSSSSSSSSSSSSSSSSSSSS",
      "SSSSS......................",
    ]),
  ),
};

// ---------------------------------------------------------------------------------------------
// Messerschmitt Bf 109, from above, nose to the right. 35 long, 37 across.
// ---------------------------------------------------------------------------------------------

const BF109: LayerStack = {
  // Wing, tailplane, and the fuselage with its canopy. Row 24 is the centreline.
  fuselage_wings: layerOf(
    piece(
      6,
      6,
      mirrored([
        "......................PPP..........",
        "......................PPPP.........",
        "......................PPPP.........",
        "......................PPPP.........",
        ".....................PPPPP.........",
        ".....................PPPPP.........",
        ".....................PPPPP.........",
        "....................PPPPPP.........",
        "....................PPPPPP.........",
        "....................PPPPPP.........",
        "...................PPPPPPP.........",
        "...................PPPPPPP.........",
        "...................PPPPPPP.........",
        "..PPP.............PPPPPPPP.........",
        ".PPPP.............PPPPPPPP.........",
        ".PPPP............PPPPPPPPP.........",
        ".PPPP............PPPPPPPPP.........",
        ".PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP...",
        "PPPPPPPPPPPPPPPPMMMMPPPPPPPPPPPPP..",
      ]),
    ),
  ),
  // The cowling and spinner hold still. The four steel dashes are the propeller.
  engines_props: layerOf(piece(33, 21, [".......M", "........", "SSSSS..M", "SSSSSSS.", "SSSSS..M", "........", ".......M"])),
  // Fin, a band behind the cockpit, and a cross on each wing.
  tail_markings: layerOf(
    piece(6, 24, ["SSSSS"]),
    piece(15, 23, ["I", "I", "I"]),
    piece(28, 12, [".I.", "III", ".I."]),
    piece(28, 34, [".I.", "III", ".I."]),
  ),
};

// ---------------------------------------------------------------------------------------------
// Zerstörer Z23, side profile, bow to the right. Hull 46 wide. Row 45 is the waterline.
// ---------------------------------------------------------------------------------------------

const Z23: LayerStack = {
  // Raked bow, raised forecastle, a row of scuttles, and the dark boot topping on the waterline.
  hull_waterline: layerOf(
    piece(1, 39, [
      "..........................PPPPPPPPPPPPPPPPPPPP",
      ".........................PPPPPPPPPPPPPPPPPPPPP",
      "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP",
      "PPPPSPPSPPSPPSPPSPPSPPSPPSPPPPSPPSPPSPPSPPPPP.",
      "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP..",
      ".PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP...",
      ".SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS....",
    ]),
  ),
  // Aft deckhouse, two raked funnels with the torpedo tubes between them, and the bridge.
  superstructure: layerOf(
    piece(6, 38, ["PPPPPPP", "PSPSPSP", "PPPPPPP"]),
    piece(14, 34, ["SSSS.", "PPPP.", ".PPPP", ".PPPP", ".PPPP", ".PPPP", ".PPPP"]),
    piece(19, 38, ["MMM", "PPP", "PPP"]),
    piece(21, 32, ["SSSSS.", "PPPPP.", "PPPPP.", ".PPPPP", ".PPPPP", ".PPPPP", ".PPPPP", ".PPPPP", ".PPPPP"]),
    piece(27, 31, [".PPPP..", ".PPPP..", "PPPPPPP", "PSSSSSP", "PPPPPPP", "PPPPPPP", "PPPPPPP", "PPPPPPP"]),
  ),
  // Twin turret forward, two guns aft, both masts, and the ensign.
  turrets_masts: layerOf(
    piece(37, 36, [".SSS....", "PPPPMMMM", "PPPP...."]),
    piece(6, 36, ["MMMPPP", "...PPP"]),
    piece(1, 39, ["MMPPP", "..PPP"]),
    piece(29, 22, [".S.", ".S.", ".S.", "SSS", ".S.", "MMM", ".S.", ".S.", ".S."]),
    piece(12, 28, [".S.", ".S.", "SSS", ".S.", ".S.", ".S.", ".S.", ".S.", ".S.", ".S.", ".S.", ".S.", ".S."]),
    piece(11, 32, ["II", "II"]),
  ),
};

export interface ArchetypeStarter {
  archetype: ArchetypeKey;
  /** The name shown in the editor and on the motion test. */
  title: string;
  blueprint: UnitSpriteSheetBlueprint;
  layers: LayerFrames;
}

function starter(
  archetype: ArchetypeKey,
  blueprintId: string,
  unitTypeId: string,
  category: UnitCategory,
  title: string,
  historicalEraTag: string,
  idle: LayerStack,
  muzzlePoint: Vec2,
): ArchetypeStarter {
  const layers = buildAnimation(
    archetype,
    { ...emptyFrames(archetype, CANVAS, CANVAS), idle },
    { unitTypeId, groundX: GROUND.x, muzzlePoint },
  );
  return {
    archetype,
    title,
    layers,
    blueprint: {
      blueprintId,
      unitTypeId,
      factionId: "GER",
      category,
      canvasSize: { width: CANVAS, height: CANVAS },
      groundOrigin: { ...GROUND },
      sheetFootAnchor: { ...SHEET_FOOT_ANCHOR },
      muzzlePoint,
      nativeFacing: "right",
      // The layers carry the recoil, so the whole sprite does not kick as well.
      recoilOffsetPx: 0,
      frames: flattenFrames(archetype, layers),
      historicalEraTag,
    },
  };
}

export const ARCHETYPE_STARTERS: ArchetypeStarter[] = [
  starter("tank", "ger_tank_pz4", "tank", "land", "Panzer IV", "1943 German Panzer IV Ausf. H medium tank", PZ4, { x: 45, y: 27 }),
  starter(
    "mech_infantry",
    "ger_mech_sdkfz251",
    "mech_infantry",
    "land",
    "Sd.Kfz. 251",
    "1943 German Sd.Kfz. 251 armoured half-track",
    SDKFZ251,
    { x: 33, y: 24 },
  ),
  starter("artillery", "ger_artillery_lefh18", "artillery", "land", "leFH 18", "1943 German 10.5 cm leFH 18 field howitzer", LEFH18, {
    x: 43,
    y: 30,
  }),
  starter("aircraft", "ger_fighter_bf109", "fighter", "air", "Bf 109", "1943 German Messerschmitt Bf 109 G fighter", BF109, {
    x: 39,
    y: 24,
  }),
  starter("ship", "ger_destroyer_z23", "destroyer", "sea", "Z23", "1943 German Zerstörer 1936A destroyer Z23", Z23, { x: 44, y: 37 }),
];

export function archetypeStarter(blueprintId: string): ArchetypeStarter | null {
  return ARCHETYPE_STARTERS.find((item) => item.blueprint.blueprintId === blueprintId) ?? null;
}
