import {
  ARCHETYPE_LAYERS,
  ARCHETYPES,
  buildAnimation,
  emptyFrames,
  emptyGrid,
  flattenFrames,
  type ArchetypeKey,
  type LayerFrames,
  type LayerStack,
} from "./archetypeLayers";
import { IMPORTED_CANDIDATES, type ImportedCandidate } from "./candidateSprites";
import { OUTLINED_CANDIDATES } from "./outlinedSprites";
import {
  SHEET_FOOT_ANCHOR,
  type PaletteSlotKey,
  type RosterFactionId,
  type SpriteFrameGrid,
  type UnitSpriteSheetBlueprint,
  type Vec2,
} from "./skeletonSchema";

/**
 * The layered starters other than infantry. Germany is the seed-1 candidate art. Britain, America,
 * and the Soviet Union use the outlined pictures where those exist. Build Animation writes the other
 * three poses. Glyphs: . empty, P hull, S trim, M steel, T track, W leather, K skin, I insignia.
 */
const CANVAS = 48;
const GROUND: Vec2 = { x: 24, y: 45 };

const GLYPH: Record<string, PaletteSlotKey | null> = {
  ".": null,
  P: "primary_uniform_or_hull",
  S: "secondary_trim_or_webbing",
  M: "metallic_steel",
  T: "metallic_brass_or_track",
  W: "wood_or_leather",
  K: "skin_stand_in",
  I: "insignia_accent",
};

function gridFromGlyphs(rows: string[]): SpriteFrameGrid {
  if (rows.length !== CANVAS || rows.some((row) => row.length !== CANVAS)) {
    throw new Error("A candidate layer is not 48×48");
  }
  return rows.map((row) =>
    [...row].map((ch) => {
      if (!(ch in GLYPH)) {
        throw new Error(`Unknown pixel grid glyph "${ch}"`);
      }
      return GLYPH[ch];
    }),
  );
}

function idleStack(archetype: ArchetypeKey, layers: Record<string, string[]>): LayerStack {
  const stack: LayerStack = {};
  for (const layer of ARCHETYPE_LAYERS[archetype]) {
    stack[layer] = layers[layer] ? gridFromGlyphs(layers[layer]) : emptyGrid(CANVAS, CANVAS);
  }
  return stack;
}

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
  title: string,
  historicalEraTag: string,
  idle: LayerStack,
  muzzlePoint: Vec2,
  factionId: RosterFactionId,
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
      factionId,
      category: ARCHETYPES[archetype].category,
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

function fromCandidate(item: ImportedCandidate): ArchetypeStarter {
  return starter(
    item.archetype,
    item.blueprintId,
    item.unitTypeId,
    item.title,
    item.historicalEraTag,
    idleStack(item.archetype, item.layers),
    item.muzzlePoint,
    item.factionId ?? "GER",
  );
}

export const ARCHETYPE_STARTERS: ArchetypeStarter[] = [...IMPORTED_CANDIDATES, ...OUTLINED_CANDIDATES].map(fromCandidate);

export function archetypeStarter(blueprintId: string): ArchetypeStarter | null {
  return ARCHETYPE_STARTERS.find((item) => item.blueprint.blueprintId === blueprintId) ?? null;
}
