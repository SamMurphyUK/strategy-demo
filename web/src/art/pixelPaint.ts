import {
  ARCHETYPES,
  ARCHETYPE_LAYERS,
  LEGACY_SHIFTS,
  MOVING_DETAIL_SLOT,
  archetypeForUnitType,
  beatStack,
  buildAnimation,
  cloneFrames,
  cloneStack,
  compositeStack,
  emptyFrames,
  flattenFrames,
  isArchetype,
  shiftProblems,
  shiftsForDivisor,
  type ArchetypeKey,
  type BuildAnimationOptions,
  type LayerFrames,
  type LayerStack,
} from "./archetypeLayers";
import { firstPixelOffCard } from "./blockoutCompiler";
import { PLAYBACK_BEATS } from "./motionPreview";
import { ARCHETYPE_STARTERS, archetypeStarter } from "./archetypeStarters";
import {
  cloneLayerStack,
  gridHasInk,
  shiftGrid,
  emptyLayerStack,
  type InfantryLayerKey,
  type InfantryLayerStack,
} from "./infantryMarch";
import { emblemCells, silhouetteOf, stampEmblem, type EmblemBitmap, type StampCell, type StampOptions } from "./emblems";
import { MILITARY } from "../ui/theme/militaryPalette";
import { layoutWalkGrid, type PartCategory } from "./paperDoll";
import { FACTION_MILITARY_MAPPINGS, STARTER_BLUEPRINTS, STARTER_INFANTRY_LAYERS } from "./starterParts";
import { MILITARY_STRIP_KEYS, SHEET_FOOT_ANCHOR, SPRITE_FRAME_KEYS, stripKeyOfSlot } from "./skeletonSchema";
import type { VehicleWardrobe } from "./vehicleParts";
import type {
  FactionMilitaryMapping,
  MilitaryStripKey,
  MotionShifts,
  PaletteSlotKey,
  RosterFactionId,
  SpriteFrameGrid,
  SpriteFrameKey,
  UnitSpriteSheetBlueprint,
  Vec2,
} from "./skeletonSchema";

export const PALETTE_SLOT_KEYS = [
  "primary_uniform_or_hull",
  "secondary_trim_or_webbing",
  "metallic_steel",
  "metallic_brass_or_track",
  "wood_or_leather",
  "skin_stand_in",
  "insignia_accent",
] as const satisfies readonly PaletteSlotKey[];

export const ROSTER_FACTIONS: RosterFactionId[] = ["GER", "USSR", "UK", "US", "JAP", "MINOR"];

export const SLOT_LABEL: Record<PaletteSlotKey, string> = {
  primary_uniform_or_hull: "Hull",
  secondary_trim_or_webbing: "Webbing",
  metallic_steel: "Steel",
  metallic_brass_or_track: "Track",
  wood_or_leather: "Leather",
  skin_stand_in: "Skin",
  insignia_accent: "Insignia",
  emblem_dark: "Emblem black",
  emblem_red: "Emblem red",
  emblem_red_light: "Emblem red, lit",
  emblem_white: "Emblem white",
  emblem_white_shade: "Emblem white, shaded",
  emblem_blue: "Emblem blue",
  emblem_grey: "Emblem grey",
  emblem_moss: "Emblem moss",
};

export const FRAME_LABEL: Record<SpriteFrameKey, string> = {
  idle: "Idle",
  move_1: "Move 1",
  move_2: "Move 2",
  fire: "Fire",
};

export type Brush = PaletteSlotKey | "eraser";

export interface UnitPaintFile {
  kind: "unit-paint";
  version: 1;
  flat: boolean;
  editingFrame: SpriteFrameKey;
  editingLayer: string | null;
  blueprint: UnitSpriteSheetBlueprint;
  layers: LayerFrames | null;
  /** The skeleton the layers belong to. Files saved before the other skeletons existed leave it out. */
  archetype?: ArchetypeKey;
}

export interface UnitPaintDocument {
  blueprint: UnitSpriteSheetBlueprint;
  editingFrame: SpriteFrameKey;
  /** A layer of this unit's skeleton, or null when the unit is four flat frames. */
  editingLayer: string | null;
  flat: boolean;
  /** The authoring layers. The game only reads blueprint.frames, which these flatten into. */
  layers: LayerFrames | null;
  archetype: ArchetypeKey;
  /**
   * The parts each layer of a vehicle can wear, and the builds saved from them. Left out until a
   * second part is made. The part a layer wears is drawn in `layers.idle`. See vehicleParts.ts.
   */
  wardrobe?: VehicleWardrobe;
}

const CANVAS = 48;

export function slotHex(mapping: FactionMilitaryMapping, slot: PaletteSlotKey): string {
  return MILITARY[stripKeyOfSlot(mapping, slot)];
}

export function documentFromBlueprint(blueprint: UnitSpriteSheetBlueprint): UnitPaintDocument {
  const source = STARTER_INFANTRY_LAYERS[blueprint.blueprintId];
  if (source) {
    return documentFromLayers(blueprint, "infantry", source);
  }
  return {
    blueprint: cloneBlueprint(blueprint),
    editingFrame: "idle",
    editingLayer: null,
    flat: false,
    layers: null,
    archetype: archetypeForUnitType(blueprint.unitTypeId) ?? "infantry",
  };
}

/** Open a unit whose poses are drawn in the layers of one skeleton. The flat frames are composited from them. */
export function documentFromLayers(blueprint: UnitSpriteSheetBlueprint, archetype: ArchetypeKey, source: LayerFrames): UnitPaintDocument {
  const layers = cloneFrames(archetype, source);
  const next = cloneBlueprint(blueprint);
  next.frames = flattenFrames(archetype, layers);
  return {
    blueprint: next,
    editingFrame: "idle",
    editingLayer: ARCHETYPE_LAYERS[archetype][0] ?? null,
    flat: false,
    layers,
    archetype,
  };
}

/** The six riflemen, then the candidate sprites, then any flat tank that has no candidate picture. */
export function starterBlueprints(): UnitSpriteSheetBlueprint[] {
  const layered = layeredStarterBlueprints();
  return [
    ...STARTER_BLUEPRINTS.filter((item) => item.unitTypeId === "infantry"),
    ...layered.values(),
    ...STARTER_BLUEPRINTS.filter((item) => item.unitTypeId !== "infantry" && !layered.has(item.blueprintId)),
  ];
}

/** Open a starter by id. A layered starter wins over a flat one with the same id. */
export function starterDocument(blueprintId: string): UnitPaintDocument | null {
  const layered = archetypeStarter(blueprintId);
  if (layered) {
    return documentFromLayers(layered.blueprint, layered.archetype, layered.layers);
  }
  const flat = STARTER_BLUEPRINTS.find((item) => item.blueprintId === blueprintId);
  return flat ? documentFromBlueprint(flat) : null;
}

function layeredStarterBlueprints(): Map<string, UnitSpriteSheetBlueprint> {
  return new Map(ARCHETYPE_STARTERS.map((item) => [item.blueprint.blueprintId, item.blueprint]));
}

/**
 * An empty sprite on one skeleton. With no arguments past the country it is the empty rifleman.
 * unitTypeId is the UNIT_DEFINITIONS key. It defaults to the first unit drawn on that skeleton.
 */
export function blankDocument(factionId: RosterFactionId, archetype: ArchetypeKey = "infantry", unitTypeId?: string): UnitPaintDocument {
  const definition = ARCHETYPES[archetype];
  const layers = emptyFrames(archetype, CANVAS, CANVAS);
  const infantry = archetype === "infantry";
  return {
    blueprint: {
      blueprintId: "custom_unit",
      unitTypeId: unitTypeId && archetypeForUnitType(unitTypeId) === archetype ? unitTypeId : (definition.unitTypes[0] ?? "infantry"),
      factionId,
      category: definition.category,
      canvasSize: { width: CANVAS, height: CANVAS },
      groundOrigin: { x: 24, y: 45 },
      sheetFootAnchor: { ...SHEET_FOOT_ANCHOR },
      muzzlePoint: infantry ? { x: 36, y: 24 } : undefined,
      nativeFacing: "right",
      recoilOffsetPx: infantry ? 1 : 0,
      frames: flattenFrames(archetype, layers),
      historicalEraTag: "custom unit",
    },
    editingFrame: "idle",
    editingLayer: ARCHETYPE_LAYERS[archetype][0] ?? null,
    flat: false,
    layers,
    archetype,
  };
}

/**
 * Say which unit the sprite is. A type on the same skeleton keeps the drawing: a field gun can become a flak gun.
 * A type on another skeleton starts an empty sprite, because the layers do not carry over.
 */
export function withUnitType(doc: UnitPaintDocument, unitTypeId: string): UnitPaintDocument {
  const archetype = archetypeForUnitType(unitTypeId);
  if (!archetype || unitTypeId === doc.blueprint.unitTypeId) {
    return doc;
  }
  if (archetype !== doc.archetype) {
    return blankDocument(doc.blueprint.factionId, archetype, unitTypeId);
  }
  return { ...doc, blueprint: { ...doc.blueprint, unitTypeId, category: ARCHETYPES[archetype].category } };
}

/** Faction changes the swatches. The slot grids stay put. */
export function withFaction(doc: UnitPaintDocument, factionId: RosterFactionId): UnitPaintDocument {
  return { ...doc, blueprint: { ...doc.blueprint, factionId } };
}

export function withEditingFrame(doc: UnitPaintDocument, frame: SpriteFrameKey): UnitPaintDocument {
  if (!SPRITE_FRAME_KEYS.includes(frame)) {
    return doc;
  }
  return { ...doc, editingFrame: frame };
}

export function withEditingLayer(doc: UnitPaintDocument, layer: string): UnitPaintDocument {
  if (!doc.layers || !ARCHETYPE_LAYERS[doc.archetype].includes(layer)) {
    return doc;
  }
  return { ...doc, editingLayer: layer };
}

const WALK_SLOT: Record<MilitaryStripKey, PaletteSlotKey> = {
  cream: "skin_stand_in",
  tan: "skin_stand_in",
  terracotta: "skin_stand_in",
  bone: "skin_stand_in",
  brass: "primary_uniform_or_hull",
  olive: "primary_uniform_or_hull",
  feldgrau: "primary_uniform_or_hull",
  sage: "primary_uniform_or_hull",
  spruce: "primary_uniform_or_hull",
  khaki: "secondary_trim_or_webbing",
  brown: "wood_or_leather",
  taupe: "secondary_trim_or_webbing",
  charcoal: "secondary_trim_or_webbing",
  plum: "insignia_accent",
  steel: "metallic_steel",
  crimson: "insignia_accent",
};

const WALK_LAYER: Record<PartCategory, InfantryLayerKey> = {
  head: "head",
  torso: "torso",
  legs: "legs",
  weapon: "hands_weapon",
};

/** Semantic rig slots 1–13, in the same order as the paper-doll palette. */
const SEMANTIC_SLOT: readonly (PaletteSlotKey | null)[] = [
  null,
  "primary_uniform_or_hull",
  "primary_uniform_or_hull",
  "secondary_trim_or_webbing",
  "secondary_trim_or_webbing",
  "insignia_accent",
  "wood_or_leather",
  "wood_or_leather",
  "skin_stand_in",
  "skin_stand_in",
  "skin_stand_in",
  "primary_uniform_or_hull",
  "metallic_steel",
  "metallic_brass_or_track",
];

/**
 * Put frame 0 of an 8-frame walk onto the pose being painted.
 * The feet sit on the ground mark. The picture is split into the four body layers.
 */
export function stampWalkStance(
  doc: UnitPaintDocument,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): UnitPaintDocument {
  const sheet = layoutWalkGrid(rgba, width, height);
  const frameWidth = sheet.width / 8;
  const frameHeight = sheet.height;
  let minX = frameWidth;
  let minY = frameHeight;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < frameHeight; y += 1) {
    for (let x = 0; x < frameWidth; x += 1) {
      if ((sheet.rgba[(y * sheet.width + x) * 4 + 3] ?? 0) < 128) {
        continue;
      }
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) {
    return doc;
  }
  const srcW = maxX - minX + 1;
  const srcH = maxY - minY + 1;
  let bootMin = maxX;
  let bootMax = minX;
  for (let x = minX; x <= maxX; x += 1) {
    if ((sheet.rgba[(maxY * sheet.width + x) * 4 + 3] ?? 0) >= 128) {
      if (x < bootMin) bootMin = x;
      if (x > bootMax) bootMax = x;
    }
  }
  const footX = Math.round((bootMin + bootMax) / 2);
  const fx = footX - minX;
  const fy = maxY - minY;
  const { width: canvasW, height: canvasH } = doc.blueprint.canvasSize;
  const ground = doc.blueprint.groundOrigin;
  let dstH = Math.min(srcH, ground.y + 1, canvasH);
  let dstW = Math.max(1, Math.min(srcW, canvasW, Math.round(srcW * (dstH / srcH))));
  const placement = () => {
    const dfx = Math.min(dstW - 1, Math.floor((fx * dstW) / srcW));
    const dfy = Math.min(dstH - 1, Math.floor((fy * dstH) / srcH));
    return { dfx, dfy, x0: ground.x - dfx, y0: ground.y - dfy };
  };
  let placed = placement();
  let guard = dstW + dstH;
  while (
    guard > 0 &&
    (placed.x0 < 0 || placed.y0 < 0 || placed.x0 + dstW > canvasW || placed.y0 + dstH > canvasH)
  ) {
    if (placed.x0 < 0 || placed.x0 + dstW > canvasW) {
      dstW = Math.max(1, dstW - 1);
    } else {
      dstH = Math.max(1, dstH - 1);
    }
    placed = placement();
    guard -= 1;
  }
  const read = (sx: number, sy: number): PaletteSlotKey | null => {
    const offset = (sy * sheet.width + sx) * 4;
    if ((sheet.rgba[offset + 3] ?? 0) < 128) {
      return null;
    }
    const key = nearestStrip(sheet.rgba[offset] ?? 0, sheet.rgba[offset + 1] ?? 0, sheet.rgba[offset + 2] ?? 0);
    if (key === "charcoal" && charcoalRim(sheet.rgba, sheet.width, frameWidth, sx, sy)) {
      return null;
    }
    return WALK_SLOT[key];
  };
  const sample = (dx: number, dy: number) => ({
    sx: minX + Math.min(srcW - 1, Math.floor((dx * srcW) / dstW)),
    sy: minY + Math.min(srcH - 1, Math.floor((dy * srcH) / dstH)),
  });
  let muzzle: Vec2 | null = null;
  const noteMuzzle = (category: PartCategory | null, x: number, y: number) => {
    if (category !== "weapon") {
      return;
    }
    if (!muzzle || x > muzzle.x || (x === muzzle.x && y < muzzle.y)) {
      muzzle = { x, y };
    }
  };
  const aim = (next: UnitPaintDocument): UnitPaintDocument =>
    muzzle ? { ...next, blueprint: { ...next.blueprint, muzzlePoint: muzzle } } : next;
  if (doc.layers && doc.archetype !== "infantry") {
    return doc;
  }
  if (doc.layers) {
    const layers = cloneFrames(doc.archetype, doc.layers);
    const stack = emptyLayerStack(canvasW, canvasH);
    for (let dy = 0; dy < dstH; dy += 1) {
      for (let dx = 0; dx < dstW; dx += 1) {
        const { sx, sy } = sample(dx, dy);
        const slot = read(sx, sy);
        const x = placed.x0 + dx;
        const y = placed.y0 + dy;
        if (!slot || !insideCanvas(doc, x, y)) {
          continue;
        }
        const category = sheet.mask[sy * sheet.width + sx] ?? null;
        noteMuzzle(category, x, y);
        writeCell(stack, category ? WALK_LAYER[category] : "torso", x, y, slot);
      }
    }
    layers[doc.editingFrame] = stack;
    return aim(withLayers(doc, layers, doc.editingFrame));
  }
  const grid = emptyGrid(canvasW, canvasH);
  for (let dy = 0; dy < dstH; dy += 1) {
    for (let dx = 0; dx < dstW; dx += 1) {
      const { sx, sy } = sample(dx, dy);
      const slot = read(sx, sy);
      const x = placed.x0 + dx;
      const y = placed.y0 + dy;
      const row = grid[y];
      if (!slot || !row || !insideCanvas(doc, x, y)) {
        continue;
      }
      noteMuzzle(sheet.mask[sy * sheet.width + sx] ?? null, x, y);
      row[x] = slot;
    }
  }
  return aim({
    ...doc,
    blueprint: {
      ...doc.blueprint,
      frames: { ...doc.blueprint.frames, [doc.editingFrame]: grid },
    },
  });
}

/**
 * Draw the four assembled rig parts onto the pose being painted. Infantry only.
 * The tunic is filled in behind the rifle, so a shift does not open a hole.
 */
export function placeRigFrame(
  doc: UnitPaintDocument,
  cells: { width: number; height: number; layers: Record<PartCategory, number[]> },
): UnitPaintDocument {
  const opaqueAt = (x: number, y: number) =>
    PART_ORDER.some((category) => (cells.layers[category][y * cells.width + x] ?? 0) !== 0);
  let minX = cells.width;
  let minY = cells.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < cells.height; y += 1) {
    for (let x = 0; x < cells.width; x += 1) {
      if (!opaqueAt(x, y)) {
        continue;
      }
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY || !doc.layers || doc.archetype !== "infantry") {
    return doc;
  }
  let bootMin = maxX;
  let bootMax = minX;
  let foundBoot = false;
  for (let x = minX; x <= maxX; x += 1) {
    const legs = cells.layers.legs[maxY * cells.width + x] ?? 0;
    const any = legs !== 0 || opaqueAt(x, maxY);
    if (!any) {
      continue;
    }
    foundBoot = true;
    if (x < bootMin) bootMin = x;
    if (x > bootMax) bootMax = x;
  }
  if (!foundBoot) {
    return doc;
  }
  const srcW = maxX - minX + 1;
  const srcH = maxY - minY + 1;
  const fx = Math.round((bootMin + bootMax) / 2) - minX;
  const fy = maxY - minY;
  const { width: canvasW, height: canvasH } = doc.blueprint.canvasSize;
  const ground = doc.blueprint.groundOrigin;
  let dstH = Math.min(srcH, ground.y + 1, canvasH);
  let dstW = Math.max(1, Math.min(srcW, canvasW, Math.round(srcW * (dstH / srcH))));
  const placement = () => {
    const dfx = Math.min(dstW - 1, Math.floor((fx * dstW) / srcW));
    const dfy = Math.min(dstH - 1, Math.floor((fy * dstH) / srcH));
    return { x0: ground.x - dfx, y0: ground.y - dfy };
  };
  let placed = placement();
  let guard = dstW + dstH;
  while (
    guard > 0 &&
    (placed.x0 < 0 || placed.y0 < 0 || placed.x0 + dstW > canvasW || placed.y0 + dstH > canvasH)
  ) {
    if (placed.x0 < 0 || placed.x0 + dstW > canvasW) {
      dstW = Math.max(1, dstW - 1);
    } else {
      dstH = Math.max(1, dstH - 1);
    }
    placed = placement();
    guard -= 1;
  }
  const layers = cloneFrames(doc.archetype, doc.layers);
  const stack = emptyLayerStack(canvasW, canvasH);
  let muzzle: Vec2 | null = null;
  for (let dy = 0; dy < dstH; dy += 1) {
    for (let dx = 0; dx < dstW; dx += 1) {
      const sx = minX + Math.min(srcW - 1, Math.floor((dx * srcW) / dstW));
      const sy = minY + Math.min(srcH - 1, Math.floor((dy * srcH) / dstH));
      const x = placed.x0 + dx;
      const y = placed.y0 + dy;
      if (!insideCanvas(doc, x, y)) {
        continue;
      }
      for (const category of PART_ORDER) {
        const semantic = cells.layers[category][sy * cells.width + sx] ?? 0;
        const slot = SEMANTIC_SLOT[semantic] ?? null;
        if (!slot) {
          continue;
        }
        writeCell(stack, WALK_LAYER[category], x, y, slot);
        if (category === "weapon" && (!muzzle || x > muzzle.x || (x === muzzle.x && y < muzzle.y))) {
          muzzle = { x, y };
        }
      }
    }
  }
  const filled = bodyUnderWeapon(stack) ?? stack;
  layers[doc.editingFrame] = filled;
  const next = withLayers(doc, layers, doc.editingFrame);
  return muzzle ? { ...next, blueprint: { ...next.blueprint, muzzlePoint: muzzle } } : next;
}

/** Paint the tunic into every empty cell the rifle covers inside the body. Infantry only. */
export function solidTorsoUnderWeapon(doc: UnitPaintDocument): UnitPaintDocument {
  if (!doc.layers || doc.archetype !== "infantry") {
    return doc;
  }
  const filled = bodyUnderWeapon(doc.layers[doc.editingFrame] as InfantryLayerStack);
  if (!filled) {
    return doc;
  }
  const layers = cloneFrames(doc.archetype, doc.layers);
  layers[doc.editingFrame] = filled;
  return withLayers(doc, layers, doc.editingFrame);
}

const PART_ORDER: readonly PartCategory[] = ["legs", "torso", "head", "weapon"];

function bodyUnderWeapon(stack: InfantryLayerStack): InfantryLayerStack | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let maxY = -1;
  const counts = new Map<PaletteSlotKey, number>();
  const torso = stack.torso;
  const height = torso.length;
  const width = torso[0]?.length ?? 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const slot = torso[y]?.[x];
      if (slot == null) {
        continue;
      }
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      counts.set(slot, (counts.get(slot) ?? 0) + 1);
    }
  }
  if (maxX < minX) {
    return null;
  }
  let ink: PaletteSlotKey = "primary_uniform_or_hull";
  let best = 0;
  for (const [slot, count] of counts) {
    if (count > best) {
      best = count;
      ink = slot;
    }
  }
  const next = cloneLayerStack(stack);
  let changed = false;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (next.hands_weapon[y]?.[x] == null || next.torso[y]?.[x] != null) {
        continue;
      }
      const row = next.torso[y];
      if (!row) {
        continue;
      }
      row[x] = ink;
      changed = true;
    }
  }
  return changed ? next : null;
}

function writeCell(stack: InfantryLayerStack, layer: InfantryLayerKey, x: number, y: number, slot: PaletteSlotKey): void {
  const row = stack[layer][y];
  if (row) {
    row[x] = slot;
  }
}

function nearestStrip(r: number, g: number, b: number): MilitaryStripKey {
  let best: MilitaryStripKey = "feldgrau";
  let bestDist = Number.POSITIVE_INFINITY;
  for (const key of MILITARY_STRIP_KEYS) {
    const rgb = Number.parseInt(MILITARY[key].slice(1), 16);
    const dr = r - ((rgb >> 16) & 255);
    const dg = g - ((rgb >> 8) & 255);
    const db = b - (rgb & 255);
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = key;
    }
  }
  return best;
}

function charcoalRim(rgba: Uint8ClampedArray, sheetWidth: number, frameWidth: number, x: number, y: number): boolean {
  const neighbors = [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1],
  ];
  return neighbors.some(([nx, ny]) => {
    if (nx === undefined || ny === undefined || nx < 0 || ny < 0 || nx >= frameWidth) {
      return true;
    }
    return (rgba[(ny * sheetWidth + nx) * 4 + 3] ?? 0) < 128;
  });
}

/** Copy an existing pose onto the frame being painted. The open frame stays selected. */
export function loadFrameOntoCurrent(doc: UnitPaintDocument, source: SpriteFrameKey): UnitPaintDocument {
  if (source === doc.editingFrame) {
    return doc;
  }
  if (doc.layers) {
    const layers = cloneFrames(doc.archetype, doc.layers);
    layers[doc.editingFrame] = cloneStack(doc.archetype, doc.layers[source]);
    return withLayers(doc, layers, doc.editingFrame);
  }
  return {
    ...doc,
    blueprint: {
      ...doc.blueprint,
      frames: {
        ...doc.blueprint.frames,
        [doc.editingFrame]: cloneGrid(doc.blueprint.frames[source]),
      },
    },
  };
}

/** Copy the open frame onto the next pose and select that pose. */
export function duplicateFrameToNext(doc: UnitPaintDocument): UnitPaintDocument {
  const next = nextFrame(doc.editingFrame);
  if (!doc.layers) {
    return {
      ...doc,
      editingFrame: next,
      blueprint: {
        ...doc.blueprint,
        frames: {
          ...doc.blueprint.frames,
          [next]: cloneGrid(doc.blueprint.frames[doc.editingFrame]),
        },
      },
    };
  }
  const layers = cloneFrames(doc.archetype, doc.layers);
  layers[next] = cloneStack(doc.archetype, doc.layers[doc.editingFrame]);
  return withLayers(doc, layers, next);
}

/** Copy the open layer onto the next pose. The other layers on that pose stay. */
export function duplicateLayerToNext(doc: UnitPaintDocument): UnitPaintDocument {
  if (!doc.layers || !doc.editingLayer) {
    return doc;
  }
  const source = doc.layers[doc.editingFrame][doc.editingLayer];
  if (!source) {
    return doc;
  }
  const next = nextFrame(doc.editingFrame);
  const layers = cloneFrames(doc.archetype, doc.layers);
  layers[next] = {
    ...layers[next],
    [doc.editingLayer]: cloneGrid(source),
  };
  return withLayers({ ...doc, editingFrame: next }, layers, next);
}

/** Place the idle head, tunic, and rifle onto the other three poses. Leg drawings on those poses stay. Infantry only. */
export function buildMarchDocument(doc: UnitPaintDocument): UnitPaintDocument {
  if (doc.archetype !== "infantry") {
    return doc;
  }
  return buildAnimationDocument(doc);
}

/**
 * Write Move 1, Move 2, and Fire from the idle layers, by the rules of this unit's skeleton.
 * Every layer moves by whole pixels. A rifleman gets the march, and keeps a leg drawing already on a step.
 */
export function buildAnimationDocument(doc: UnitPaintDocument): UnitPaintDocument {
  if (!doc.layers) {
    return doc;
  }
  const layers = buildAnimation(doc.archetype, doc.layers, animationOptions(doc));
  return withLayers(doc, layers, doc.editingFrame);
}

/** Move the foot pin. The painted frames stay where they are. */
export function placeGroundOrigin(doc: UnitPaintDocument, x: number, y: number): UnitPaintDocument {
  if (!insideCanvas(doc, x, y)) {
    return doc;
  }
  return { ...doc, blueprint: { ...doc.blueprint, groundOrigin: { x, y } } };
}

export function placeMuzzle(doc: UnitPaintDocument, x: number, y: number): UnitPaintDocument {
  if (!insideCanvas(doc, x, y)) {
    return doc;
  }
  return { ...doc, blueprint: { ...doc.blueprint, muzzlePoint: { x, y } } };
}

/** Slide the layer being painted, on this pose only. Pixels that leave the canvas are dropped. */
export function nudgeLayer(doc: UnitPaintDocument, dx: number, dy: number): UnitPaintDocument {
  if (!doc.layers || !doc.editingLayer || (dx === 0 && dy === 0)) {
    return doc;
  }
  const source = doc.layers[doc.editingFrame][doc.editingLayer];
  if (!source || !gridHasInk(source)) {
    return doc;
  }
  const layers = cloneFrames(doc.archetype, doc.layers);
  layers[doc.editingFrame] = {
    ...layers[doc.editingFrame],
    [doc.editingLayer]: shiftGrid(source, dx, dy),
  };
  return withLayers(doc, layers, doc.editingFrame);
}

/** Paint one cell of the open layer, or of the flat frame when the unit has no layers. */
export function paintAt(doc: UnitPaintDocument, canvasX: number, canvasY: number, brush: Brush): UnitPaintDocument {
  if (!insideCanvas(doc, canvasX, canvasY)) {
    return doc;
  }
  const slot = brush === "eraser" ? null : brush;
  if (doc.layers && doc.editingLayer) {
    // Only the row under the brush is copied. A plate has tens of thousands of cells and a stroke is many calls.
    const stack = doc.layers[doc.editingFrame];
    const changed: LayerStack = {};
    if (brush === "eraser") {
      for (const layer of ARCHETYPE_LAYERS[doc.archetype]) {
        const grid = stack[layer];
        if (grid && grid[canvasY]?.[canvasX] != null) {
          changed[layer] = withCell(grid, canvasX, canvasY, null);
        }
      }
      if (Object.keys(changed).length === 0) {
        return doc;
      }
    } else {
      const grid = stack[doc.editingLayer];
      if (!grid || !grid[canvasY]) {
        return doc;
      }
      changed[doc.editingLayer] = withCell(grid, canvasX, canvasY, slot);
    }
    const nextStack = { ...stack, ...changed };
    let shown: PaletteSlotKey | null = null;
    for (const layer of ARCHETYPE_LAYERS[doc.archetype]) {
      shown = nextStack[layer]?.[canvasY]?.[canvasX] ?? shown;
    }
    return {
      ...doc,
      layers: { ...doc.layers, [doc.editingFrame]: nextStack },
      blueprint: {
        ...doc.blueprint,
        frames: {
          ...doc.blueprint.frames,
          [doc.editingFrame]: withCell(doc.blueprint.frames[doc.editingFrame], canvasX, canvasY, shown),
        },
      },
    };
  }
  const grid = cloneGrid(doc.blueprint.frames[doc.editingFrame]);
  const row = grid[canvasY];
  if (!row) {
    return doc;
  }
  row[canvasX] = slot;
  return {
    ...doc,
    blueprint: {
      ...doc.blueprint,
      frames: { ...doc.blueprint.frames, [doc.editingFrame]: grid },
    },
  };
}

/** Which cells of this pose a stamp may write: all of them, or only where some layer has ink. */
function stampOptions(doc: UnitPaintDocument, onlySprite: boolean): StampOptions {
  if (!onlySprite) {
    return {};
  }
  if (doc.layers) {
    const stack = doc.layers[doc.editingFrame];
    return { onlyOn: silhouetteOf(ARCHETYPE_LAYERS[doc.archetype].map((layer) => stack[layer])) };
  }
  return { onlyOn: silhouetteOf([doc.blueprint.frames[doc.editingFrame]]) };
}

/** The cells a stamp at (x, y) would write. The hover preview draws these. */
export function stampPreviewCells(doc: UnitPaintDocument, bitmap: EmblemBitmap, x: number, y: number, onlySprite: boolean): StampCell[] {
  return emblemCells(bitmap, { x, y }, doc.blueprint.canvasSize, stampOptions(doc, onlySprite));
}

/**
 * Stamp a national emblem, its middle on (x, y). It goes on the open layer, or on the flat frame when the
 * unit has no layers. With `onlySprite` it lands only where some layer of this pose has ink, so it cannot
 * hang off the hull. The document comes back unchanged when nothing would be written.
 */
export function stampEmblemAt(doc: UnitPaintDocument, bitmap: EmblemBitmap, x: number, y: number, onlySprite: boolean): UnitPaintDocument {
  const options = stampOptions(doc, onlySprite);
  if (emblemCells(bitmap, { x, y }, doc.blueprint.canvasSize, options).length === 0) {
    return doc;
  }
  if (doc.layers && doc.editingLayer) {
    const open = doc.layers[doc.editingFrame][doc.editingLayer];
    if (!open) {
      return doc;
    }
    const layers = cloneFrames(doc.archetype, doc.layers);
    layers[doc.editingFrame] = { ...layers[doc.editingFrame], [doc.editingLayer]: stampEmblem(open, bitmap, { x, y }, options) };
    return withLayers(doc, layers, doc.editingFrame);
  }
  const frame = doc.blueprint.frames[doc.editingFrame];
  const frames = { ...doc.blueprint.frames, [doc.editingFrame]: stampEmblem(frame, bitmap, { x, y }, options) };
  return { ...doc, blueprint: { ...doc.blueprint, frames } };
}

/** The frames are already flat. Mark the document so a kept picture can be put back. */
export function flattenBlockout(doc: UnitPaintDocument): UnitPaintDocument {
  return { ...doc, flat: true };
}

export function flattenRgba(
  doc: UnitPaintDocument,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  mapping: FactionMilitaryMapping,
): UnitPaintDocument {
  if (width !== doc.blueprint.canvasSize.width || height !== doc.blueprint.canvasSize.height) {
    throw new Error(`Candidate ${width}×${height} does not match the ${doc.blueprint.canvasSize.width}×${doc.blueprint.canvasSize.height} grid`);
  }
  const palette = activeEntries(mapping);
  const grid: SpriteFrameGrid = [];
  for (let y = 0; y < height; y++) {
    const row: (PaletteSlotKey | null)[] = [];
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      row.push(rgba[offset + 3] >= 128 ? nearestSlot(rgba[offset], rgba[offset + 1], rgba[offset + 2], palette) : null);
    }
    grid.push(row);
  }
  if (doc.layers && doc.editingLayer) {
    const layers = cloneFrames(doc.archetype, doc.layers);
    layers[doc.editingFrame] = {
      ...layers[doc.editingFrame],
      [doc.editingLayer]: grid,
    };
    return { ...withLayers(doc, layers, doc.editingFrame), flat: true };
  }
  return {
    ...doc,
    flat: true,
    blueprint: {
      ...doc.blueprint,
      frames: { ...doc.blueprint.frames, [doc.editingFrame]: grid },
    },
  };
}

export const MOTION_SPRITE_KEY = "strategy-demo.motion-sprite";

/** Remember the sprite open in the editor so the motion test can march it. */
export function saveMotionSprite(doc: UnitPaintDocument): void {
  sessionStorage.setItem(MOTION_SPRITE_KEY, JSON.stringify(toPaintFile(doc)));
}

export function loadMotionSprite(): UnitPaintDocument | null {
  try {
    const raw = sessionStorage.getItem(MOTION_SPRITE_KEY);
    if (!raw) {
      return null;
    }
    return fromPaintFile(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function toPaintFile(doc: UnitPaintDocument): UnitPaintFile {
  return {
    kind: "unit-paint",
    version: 1,
    flat: doc.flat,
    editingFrame: doc.editingFrame,
    editingLayer: doc.editingLayer,
    blueprint: doc.blueprint,
    layers: doc.layers,
    archetype: doc.archetype,
  };
}

export function fromPaintFile(value: unknown): UnitPaintDocument {
  if (!isRecord(value) || value.kind !== "unit-paint" || value.version !== 1) {
    throw new Error("That file is not a unit paint JSON.");
  }
  const blueprint = value.blueprint;
  if (!isBlueprint(blueprint)) {
    throw new Error("The unit JSON has no blueprint.");
  }
  if (blueprint.canvasSize.width !== CANVAS || blueprint.canvasSize.height !== CANVAS) {
    throw new Error("The unit canvas must be 48×48.");
  }
  const editingFrame = SPRITE_FRAME_KEYS.includes(value.editingFrame as SpriteFrameKey)
    ? (value.editingFrame as SpriteFrameKey)
    : "idle";
  const width = blueprint.canvasSize.width;
  const height = blueprint.canvasSize.height;
  // A file from before the other skeletons says nothing, so the unit type decides. Every layered file of that age is a rifleman.
  const archetype = isArchetype(value.archetype) ? value.archetype : (archetypeForUnitType(blueprint.unitTypeId) ?? "infantry");
  const layers = readLayers(value.layers, archetype, width, height);
  const next = cloneBlueprint(blueprint);
  if (layers) {
    next.frames = flattenFrames(archetype, layers);
  }
  const stack = ARCHETYPE_LAYERS[archetype];
  const editingLayer = !layers
    ? null
    : typeof value.editingLayer === "string" && stack.includes(value.editingLayer)
      ? value.editingLayer
      : (stack[0] ?? null);
  return {
    blueprint: next,
    editingFrame,
    editingLayer,
    flat: value.flat === true,
    layers,
    archetype,
  };
}

/** A faction's seven slots as the colours they paint. */
export function activeEntries(mapping: FactionMilitaryMapping): { slot: PaletteSlotKey; r: number; g: number; b: number }[] {
  return PALETTE_SLOT_KEYS.map((slot) => {
    const rgb = Number.parseInt(MILITARY[mapping[slot]].slice(1), 16);
    return { slot, r: (rgb >> 16) & 255, g: (rgb >> 8) & 255, b: rgb & 255 };
  });
}

/** The slot whose colour is nearest. Two slots of one colour go to the earlier slot. */
export function nearestSlot(
  r: number,
  g: number,
  b: number,
  palette: readonly { slot: PaletteSlotKey; r: number; g: number; b: number }[],
): PaletteSlotKey {
  let best = palette[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const entry of palette) {
    const dr = r - entry.r;
    const dg = g - entry.g;
    const db = b - entry.b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = entry;
    }
  }
  return best?.slot ?? "primary_uniform_or_hull";
}

function insideCanvas(doc: UnitPaintDocument, x: number, y: number): boolean {
  const { width, height } = doc.blueprint.canvasSize;
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height;
}

function withLayers(doc: UnitPaintDocument, layers: LayerFrames, frame: SpriteFrameKey): UnitPaintDocument {
  return {
    ...doc,
    editingFrame: frame,
    layers,
    blueprint: {
      ...doc.blueprint,
      frames: flattenFrames(doc.archetype, layers),
    },
  };
}

function nextFrame(frame: SpriteFrameKey): SpriteFrameKey {
  const index = SPRITE_FRAME_KEYS.indexOf(frame);
  return SPRITE_FRAME_KEYS[(index + 1) % SPRITE_FRAME_KEYS.length] ?? "move_1";
}

function readLayers(value: unknown, archetype: ArchetypeKey, width: number, height: number): LayerFrames | null {
  if (value == null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new Error("The unit JSON has no layers.");
  }
  const frames = emptyFrames(archetype, width, height);
  for (const frame of SPRITE_FRAME_KEYS) {
    const stack = value[frame];
    if (!isRecord(stack)) {
      throw new Error(`The ${frame} layers are missing.`);
    }
    for (const layer of ARCHETYPE_LAYERS[archetype]) {
      const grid = stack[layer];
      if (!isGrid(grid, width, height)) {
        throw new Error(`The ${layer} layer on ${frame} is not a ${width}×${height} grid.`);
      }
      frames[frame][layer] = cloneGrid(grid);
    }
  }
  return frames;
}

function emptyGrid(width: number, height: number): SpriteFrameGrid {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => null));
}

function cloneGrid(grid: SpriteFrameGrid): SpriteFrameGrid {
  return grid.map((row) => row.slice());
}

function cloneBlueprint(blueprint: UnitSpriteSheetBlueprint): UnitSpriteSheetBlueprint {
  return {
    ...blueprint,
    groundOrigin: { ...blueprint.groundOrigin },
    sheetFootAnchor: { ...blueprint.sheetFootAnchor },
    muzzlePoint: blueprint.muzzlePoint ? { ...blueprint.muzzlePoint } : undefined,
    referencePlatePaths: blueprint.referencePlatePaths ? [...blueprint.referencePlatePaths] : undefined,
    frames: {
      idle: cloneGrid(blueprint.frames.idle),
      move_1: cloneGrid(blueprint.frames.move_1),
      move_2: cloneGrid(blueprint.frames.move_2),
      fire: cloneGrid(blueprint.frames.fire),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGrid(value: unknown, width: number, height: number): value is SpriteFrameGrid {
  return Array.isArray(value) && value.length === height && value.every((row) => Array.isArray(row) && row.length === width);
}

function isBlueprint(value: unknown): value is UnitSpriteSheetBlueprint {
  if (!isRecord(value) || !isRecord(value.canvasSize) || !isRecord(value.frames)) {
    return false;
  }
  const width = value.canvasSize.width;
  const height = value.canvasSize.height;
  if (typeof width !== "number" || typeof height !== "number") {
    return false;
  }
  const frames = value.frames;
  return (
    typeof value.blueprintId === "string" &&
    typeof value.factionId === "string" &&
    ROSTER_FACTIONS.includes(value.factionId as RosterFactionId) &&
    isVec(value.groundOrigin) &&
    SPRITE_FRAME_KEYS.every((key) => isGrid(frames[key], width, height))
  );
}

function isVec(value: unknown): value is Vec2 {
  return isRecord(value) && typeof value.x === "number" && typeof value.y === "number";
}

/** The grid with one cell changed. Every other row is shared with the grid it came from. */
function withCell(grid: SpriteFrameGrid, x: number, y: number, slot: PaletteSlotKey | null): SpriteFrameGrid {
  const next = grid.slice();
  const row = (grid[y] ?? []).slice();
  row[x] = slot;
  next[y] = row;
  return next;
}

/**
 * A plate is a unit drawn at the size it was baked at. It carries a display divisor, which scales it
 * onto the 80×56 card. The 48-pixel starters carry none and are copied onto the card as they are.
 */
export function isPlate(doc: UnitPaintDocument): boolean {
  return doc.blueprint.displayDivisor !== undefined;
}

/** How this unit's layers move. A plate brings its own shifts and its block size. */
export function animationOptions(doc: UnitPaintDocument): BuildAnimationOptions {
  return {
    unitTypeId: doc.blueprint.unitTypeId,
    groundX: doc.blueprint.groundOrigin.x,
    muzzlePoint: doc.blueprint.muzzlePoint ?? null,
    shifts: doc.blueprint.motion,
    unit: doc.blueprint.displayDivisor ?? 1,
  };
}

export function plateShifts(doc: UnitPaintDocument): MotionShifts {
  return doc.blueprint.motion ?? LEGACY_SHIFTS;
}

function rebuiltPlate(doc: UnitPaintDocument): UnitPaintDocument {
  return doc.layers && doc.archetype !== "infantry" ? buildAnimationDocument(doc) : doc;
}

/** Set how many plate pixels make one card pixel, and build the poses again. The shifts are left as they are. */
export function withDisplayDivisor(doc: UnitPaintDocument, divisor: number): UnitPaintDocument {
  if (!Number.isInteger(divisor) || divisor < 1) {
    return doc;
  }
  return rebuiltPlate({
    ...doc,
    blueprint: { ...doc.blueprint, displayDivisor: divisor, motion: doc.blueprint.motion ?? shiftsForDivisor(divisor) },
  });
}

/** Set how far the layers move, and build the poses again. */
export function withMotionShifts(doc: UnitPaintDocument, shifts: MotionShifts): UnitPaintDocument {
  const whole = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);
  return rebuiltPlate({
    ...doc,
    blueprint: {
      ...doc.blueprint,
      motion: { bobPx: whole(shifts.bobPx), recoilPx: whole(shifts.recoilPx), treadStride: Math.max(1, whole(shifts.treadStride)) },
    },
  });
}

/**
 * Why this unit would not export to a clean card: a shift that is not a whole number of card pixels,
 * or a beat whose ink lands on the card's outer pixel or off the card. An empty list means it exports.
 */
export function plateProblems(doc: UnitPaintDocument): string[] {
  const divisor = doc.blueprint.displayDivisor ?? 1;
  const problems = isPlate(doc) ? shiftProblems(plateShifts(doc), divisor) : [];
  const placement = {
    groundOrigin: doc.blueprint.groundOrigin,
    sheetFootAnchor: doc.blueprint.sheetFootAnchor,
    displayDivisor: divisor,
  };
  const seen = new Set<string>();
  for (const beat of PLAYBACK_BEATS) {
    const key = doc.layers ? `${beat.pose}:${beat.recoil}` : beat.flat;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const grid = doc.layers
      ? compositeStack(doc.archetype, beatStack(doc.archetype, doc.layers, beat, animationOptions(doc)))
      : doc.blueprint.frames[beat.flat];
    const off = firstPixelOffCard(grid, placement);
    if (off) {
      problems.push(`${beat.name} leaves the card at (${off.x}, ${off.y}).`);
    }
  }
  return problems;
}

const LARGEST_DIVISOR = 64;

/**
 * The smallest divisor at which every beat fits the card, with one card pixel of bob and tread and two
 * of recoil. It is sized on all the beats, because the recoil, the bob, the foam, and the flash all
 * reach past the idle pose.
 */
export function fitDivisor(doc: UnitPaintDocument): number {
  for (let divisor = 1; divisor < LARGEST_DIVISOR; divisor += 1) {
    const placement = {
      groundOrigin: doc.blueprint.groundOrigin,
      sheetFootAnchor: doc.blueprint.sheetFootAnchor,
      displayDivisor: divisor,
    };
    if (firstPixelOffCard(doc.blueprint.frames.idle, placement)) {
      continue;
    }
    const candidate = rebuiltPlate({
      ...doc,
      blueprint: { ...doc.blueprint, displayDivisor: divisor, motion: shiftsForDivisor(divisor) },
    });
    if (plateProblems(candidate).length === 0) {
      return divisor;
    }
  }
  return LARGEST_DIVISOR;
}

/** Give the unit the smallest divisor that fits, the shifts that go with it, and the poses built from them. */
export function fitPlate(doc: UnitPaintDocument): UnitPaintDocument {
  const divisor = fitDivisor(doc);
  return rebuiltPlate({
    ...doc,
    blueprint: { ...doc.blueprint, displayDivisor: divisor, motion: shiftsForDivisor(divisor) },
  });
}

/** A set of canvas cells: a box, a lasso, or the cells a move took. */
export interface CellMask {
  width: number;
  height: number;
  /** One byte a cell, row by row. Anything but 0 is in the set. */
  cells: Uint8Array;
}

export function emptyMask(width: number, height: number): CellMask {
  return { width, height, cells: new Uint8Array(width * height) };
}

export function maskHas(mask: CellMask, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < mask.width && y < mask.height && mask.cells[y * mask.width + x] !== 0;
}

export function maskCount(mask: CellMask): number {
  let count = 0;
  for (const cell of mask.cells) {
    if (cell !== 0) {
      count += 1;
    }
  }
  return count;
}

/** Every cell of the box with these two corners, both included. */
export function rectMask(width: number, height: number, a: Vec2, b: Vec2): CellMask {
  const mask = emptyMask(width, height);
  const left = Math.max(0, Math.min(a.x, b.x));
  const right = Math.min(width - 1, Math.max(a.x, b.x));
  const top = Math.max(0, Math.min(a.y, b.y));
  const bottom = Math.min(height - 1, Math.max(a.y, b.y));
  for (let y = top; y <= bottom; y += 1) {
    mask.cells.fill(1, y * width + left, y * width + right + 1);
  }
  return mask;
}

/** Every cell inside a lasso drawn through these cells, and the cells of the line itself. The last point joins the first. */
export function polygonMask(width: number, height: number, points: readonly Vec2[]): CellMask {
  const mask = emptyMask(width, height);
  const mark = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < width && y < height) {
      mask.cells[y * width + x] = 1;
    }
  };
  for (let index = 0; index < points.length; index += 1) {
    const from = points[index];
    const to = points[(index + 1) % points.length];
    if (!from || !to) {
      continue;
    }
    const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
    for (let step = 0; step <= steps; step += 1) {
      const t = steps === 0 ? 0 : step / steps;
      mark(Math.round(from.x + (to.x - from.x) * t), Math.round(from.y + (to.y - from.y) * t));
    }
  }
  if (points.length < 3) {
    return mask;
  }
  for (let y = 0; y < height; y += 1) {
    const crossings: number[] = [];
    for (let index = 0; index < points.length; index += 1) {
      const from = points[index];
      const to = points[(index + 1) % points.length];
      if (!from || !to || from.y === to.y) {
        continue;
      }
      // Half a cell off the points' rows, so a scanline never passes exactly through a corner.
      const scan = y + 0.25;
      if (scan < Math.min(from.y, to.y) || scan >= Math.max(from.y, to.y)) {
        continue;
      }
      crossings.push(from.x + ((scan - from.y) / (to.y - from.y)) * (to.x - from.x));
    }
    crossings.sort((left, right) => left - right);
    for (let pair = 0; pair + 1 < crossings.length; pair += 2) {
      const start = Math.max(0, Math.ceil(crossings[pair] ?? 0));
      const end = Math.min(width - 1, Math.floor(crossings[pair + 1] ?? -1));
      for (let x = start; x <= end; x += 1) {
        mask.cells[y * width + x] = 1;
      }
    }
  }
  return mask;
}

/**
 * The block of plate pixels that makes the one card pixel under this cell. The steel brush on a plate
 * paints a block at a time, so a tread link is one card pixel and a stride moves it by one.
 */
export function cardBlockMask(doc: UnitPaintDocument, x: number, y: number): CellMask {
  const { width, height } = doc.blueprint.canvasSize;
  const divisor = doc.blueprint.displayDivisor ?? 1;
  const ground = doc.blueprint.groundOrigin;
  const left = ground.x + Math.floor((x - ground.x) / divisor) * divisor;
  const bottom = ground.y + Math.ceil((y - ground.y) / divisor) * divisor;
  return rectMask(width, height, { x: left, y: bottom - divisor + 1 }, { x: left + divisor - 1, y: bottom });
}

export interface RegionTransfer {
  /** The layers after the move. The stack passed in is not changed. */
  stack: LayerStack;
  /** The cells that changed layer. */
  moved: CellMask;
  count: number;
}

/**
 * Move the ink of one layer, inside a region, onto another layer at the same cells.
 * Moving up, a cell the upper layer already paints stays where it is, because it was hidden anyway.
 * Moving down, the ink replaces what was under it. Either way the flat pose keeps its pixels, unless
 * a layer between the two paints the same cell.
 */
export function transferRegionToLayer(
  archetype: ArchetypeKey,
  stack: LayerStack,
  fromLayer: string,
  toLayer: string,
  region: CellMask,
): RegionTransfer {
  const order = ARCHETYPE_LAYERS[archetype];
  const fromIndex = order.indexOf(fromLayer);
  const toIndex = order.indexOf(toLayer);
  if (fromIndex < 0 || toIndex < 0) {
    throw new Error(`The ${archetype} skeleton has no ${fromIndex < 0 ? fromLayer : toLayer} layer.`);
  }
  const moved = emptyMask(region.width, region.height);
  const source = stack[fromLayer];
  const target = stack[toLayer];
  if (fromIndex === toIndex || !source || !target) {
    return { stack, moved, count: 0 };
  }
  const from = cloneGrid(source);
  const to = cloneGrid(target);
  const upward = toIndex > fromIndex;
  let count = 0;
  for (let y = 0; y < region.height; y += 1) {
    const fromRow = from[y];
    const toRow = to[y];
    if (!fromRow || !toRow) {
      continue;
    }
    for (let x = 0; x < region.width; x += 1) {
      const slot = fromRow[x];
      if (region.cells[y * region.width + x] === 0 || slot == null || (upward && toRow[x] != null)) {
        continue;
      }
      toRow[x] = slot;
      fromRow[x] = null;
      moved.cells[y * region.width + x] = 1;
      count += 1;
    }
  }
  return { stack: { ...stack, [fromLayer]: from, [toLayer]: to }, moved, count };
}

/**
 * Fill the hole a lifted part left in the layer under it, so the part can shift without showing a gap.
 * A vacated cell is filled when the layer still has ink on both sides of it in its row, or above and
 * below it in its column. It takes the colour of the nearest of those. A cell with ink on one side
 * only is outside the layer's shape and stays empty, so a lifted barrel leaves no stub of hull behind.
 * `reach` stops the fill that many cells in from the remaining ink.
 */
export function healUncoveredCells(layer: SpriteFrameGrid, vacated: CellMask, reach = Number.POSITIVE_INFINITY): SpriteFrameGrid {
  const height = layer.length;
  const width = layer[0]?.length ?? 0;
  const size = width * height;
  const NONE = -1;
  // Four sweeps: from the left, the right, above, and below. Each records, for every cell, how far
  // back the last ink was and what colour it was.
  const sweep = (lines: number, length: number, indexAt: (line: number, step: number) => number): Sweep => {
    const found: Sweep = { distance: new Int32Array(size).fill(NONE), colour: new Array<PaletteSlotKey | null>(size).fill(null) };
    for (let line = 0; line < lines; line += 1) {
      let last: PaletteSlotKey | null = null;
      let at = 0;
      for (let step = 0; step < length; step += 1) {
        const index = indexAt(line, step);
        const slot = layer[Math.floor(index / width)]?.[index % width];
        if (slot != null) {
          last = slot;
          at = step;
        }
        if (last != null) {
          found.distance[index] = step - at;
          found.colour[index] = last;
        }
      }
    }
    return found;
  };
  const fromLeft = sweep(height, width, (y, step) => y * width + step);
  const fromRight = sweep(height, width, (y, step) => y * width + (width - 1 - step));
  const fromAbove = sweep(width, height, (x, step) => step * width + x);
  const fromBelow = sweep(width, height, (x, step) => (height - 1 - step) * width + x);
  const next = cloneGrid(layer);
  for (let y = 0; y < height; y += 1) {
    const row = next[y];
    if (!row) {
      continue;
    }
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!maskHas(vacated, x, y) || row[x] != null) {
        continue;
      }
      const has = (found: Sweep) => found.distance[index] !== NONE;
      const sides = [...(has(fromLeft) && has(fromRight) ? [fromLeft, fromRight] : []), ...(has(fromAbove) && has(fromBelow) ? [fromAbove, fromBelow] : [])];
      let nearest: Sweep | null = null;
      for (const side of sides) {
        if (!nearest || (side.distance[index] ?? 0) < (nearest.distance[index] ?? 0)) {
          nearest = side;
        }
      }
      if (!nearest || (nearest.distance[index] ?? 0) > reach) {
        continue;
      }
      row[x] = nearest.colour[index] ?? null;
    }
  }
  return next;
}

interface Sweep {
  distance: Int32Array;
  colour: (PaletteSlotKey | null)[];
}

/** Keep the cells of a region that fall on every `every`-th block column, counted from `originX`. Two gives link, gap, link, gap. */
export function linkStripes(region: CellMask, originX: number, block: number, every = 2): CellMask {
  const side = Math.max(1, Math.floor(block));
  const period = Math.max(2, Math.floor(every));
  const stripes = emptyMask(region.width, region.height);
  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      const column = Math.floor((x - originX) / side);
      if (region.cells[y * region.width + x] !== 0 && ((column % period) + period) % period === 0) {
        stripes.cells[y * region.width + x] = 1;
      }
    }
  }
  return stripes;
}

/**
 * Turn the ink inside a region into steel, which is the colour Build Animation steps along a tread or
 * a propeller. Empty cells stay empty, so the layer keeps its shape.
 */
export function paintSteelLinks(layer: SpriteFrameGrid, region: CellMask): SpriteFrameGrid {
  return layer.map((row, y) =>
    row.map((slot, x) => (slot != null && maskHas(region, x, y) ? MOVING_DETAIL_SLOT : slot)),
  );
}

/** A plate's Move and Fire are always built from Idle, so its tools work on Idle. */
function toolFrame(doc: UnitPaintDocument): SpriteFrameKey {
  return isPlate(doc) ? "idle" : doc.editingFrame;
}

function withToolStack(doc: UnitPaintDocument, stack: LayerStack): UnitPaintDocument {
  if (!doc.layers) {
    return doc;
  }
  const next = withLayers(doc, { ...doc.layers, [toolFrame(doc)]: stack }, doc.editingFrame);
  return isPlate(next) ? rebuiltPlate(next) : next;
}

/**
 * Send what shows inside a region to one layer. Each cell is taken from whichever layer shows there.
 * With `heal`, a layer below the destination has the hole filled, so the pose looks the same until a
 * part moves.
 */
export function moveRegionToLayer(
  doc: UnitPaintDocument,
  region: CellMask,
  toLayer: string,
  heal: boolean,
): { doc: UnitPaintDocument; moved: number } {
  const order = ARCHETYPE_LAYERS[doc.archetype];
  const toIndex = order.indexOf(toLayer);
  if (!doc.layers || toIndex < 0) {
    return { doc, moved: 0 };
  }
  const original = doc.layers[toolFrame(doc)];
  let stack = original;
  let total = 0;
  order.forEach((fromLayer, fromIndex) => {
    if (fromIndex === toIndex) {
      return;
    }
    const showing = emptyMask(region.width, region.height);
    let any = false;
    for (let y = 0; y < region.height; y += 1) {
      for (let x = 0; x < region.width; x += 1) {
        if (region.cells[y * region.width + x] !== 0 && topLayerAt(order, original, x, y) === fromLayer) {
          showing.cells[y * region.width + x] = 1;
          any = true;
        }
      }
    }
    if (!any) {
      return;
    }
    const transfer = transferRegionToLayer(doc.archetype, stack, fromLayer, toLayer, showing);
    stack = transfer.stack;
    total += transfer.count;
    const source = stack[fromLayer];
    if (heal && fromIndex < toIndex && source && transfer.count > 0) {
      stack = { ...stack, [fromLayer]: healUncoveredCells(source, transfer.moved) };
    }
  });
  return total === 0 ? { doc, moved: 0 } : { doc: withToolStack(doc, stack), moved: total };
}

function topLayerAt(order: readonly string[], stack: LayerStack, x: number, y: number): string | null {
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const layer = order[index];
    if (layer && stack[layer]?.[y]?.[x] != null) {
      return layer;
    }
  }
  return null;
}

/** Turn the open layer's ink inside a region into steel. */
export function tagSteel(doc: UnitPaintDocument, region: CellMask): UnitPaintDocument {
  if (!doc.layers || !doc.editingLayer) {
    return doc;
  }
  const stack = doc.layers[toolFrame(doc)];
  const layer = stack[doc.editingLayer];
  if (!layer) {
    return doc;
  }
  return withToolStack(doc, { ...stack, [doc.editingLayer]: paintSteelLinks(layer, region) });
}

/** The layer a baked picture lands on before it is cut up: the body, which every other layer sits on or under. */
export const PLATE_BODY_LAYER: Record<Exclude<ArchetypeKey, "infantry">, string> = {
  tank: "hull",
  mech_infantry: "chassis",
  artillery: "carriage_wheels",
  aircraft: "fuselage_wings",
  ship: "hull_waterline",
};

export interface PlateSource {
  factionId: RosterFactionId;
  unitTypeId: string;
  /** Straight RGBA at the size the picture was baked. */
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  blueprintId?: string;
  title?: string;
  /** Where the picture came from, kept on the blueprint. */
  sourcePath?: string;
}

/**
 * Open a baked picture as a plate, at its own size. The picture is cropped to its ink, snapped to the
 * faction's seven slots, and put whole on the body layer. The ground point is the bottom middle of
 * the ink and the muzzle mark is its right-hand tip. The divisor is the smallest that fits the card.
 */
export function plateDocument(source: PlateSource): UnitPaintDocument {
  const archetype = archetypeForUnitType(source.unitTypeId);
  if (!archetype || archetype === "infantry") {
    throw new Error(`A plate has to be a vehicle, an aircraft, or a ship. "${source.unitTypeId}" is not.`);
  }
  if (source.rgba.length !== source.width * source.height * 4) {
    throw new Error(`The picture is not ${source.width}×${source.height}.`);
  }
  const opaque = (x: number, y: number) => (source.rgba[(y * source.width + x) * 4 + 3] ?? 0) >= 128;
  let minX = source.width;
  let minY = source.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      if (!opaque(x, y)) {
        continue;
      }
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX) {
    throw new Error("The picture is empty.");
  }
  const inkW = maxX - minX + 1;
  const inkH = maxY - minY + 1;
  // Room around the ink for the recoil, the bob, the foam, and the flash, which are a few card pixels each.
  const roughDivisor = Math.max(1, Math.ceil(inkW / 76), Math.ceil(inkH / 50));
  const pad = roughDivisor * 6 + 4;
  const width = inkW + pad * 2;
  const height = inkH + pad * 2;
  const palette = activeEntries(FACTION_MILITARY_MAPPINGS[source.factionId]);
  const body = emptyGrid(width, height);
  for (let y = minY; y <= maxY; y += 1) {
    const row = body[y - minY + pad];
    if (!row) {
      continue;
    }
    for (let x = minX; x <= maxX; x += 1) {
      if (!opaque(x, y)) {
        continue;
      }
      const offset = (y * source.width + x) * 4;
      row[x - minX + pad] = nearestSlot(source.rgba[offset] ?? 0, source.rgba[offset + 1] ?? 0, source.rgba[offset + 2] ?? 0, palette);
    }
  }
  const tipRows: number[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    if (opaque(maxX, y)) {
      tipRows.push(y - minY + pad);
    }
  }
  const layers = emptyFrames(archetype, width, height);
  layers.idle[PLATE_BODY_LAYER[archetype]] = body;
  const blueprint: UnitSpriteSheetBlueprint = {
    blueprintId: source.blueprintId ?? `${source.factionId.toLowerCase()}_${source.unitTypeId}`,
    unitTypeId: source.unitTypeId,
    factionId: source.factionId,
    category: ARCHETYPES[archetype].category,
    canvasSize: { width, height },
    groundOrigin: { x: pad + Math.floor((inkW - 1) / 2), y: pad + inkH - 1 },
    sheetFootAnchor: { ...SHEET_FOOT_ANCHOR },
    muzzlePoint: { x: pad + inkW - 1, y: tipRows[Math.floor(tipRows.length / 2)] ?? pad },
    nativeFacing: "right",
    recoilOffsetPx: 0,
    frames: flattenFrames(archetype, layers),
    referencePlatePaths: source.sourcePath ? [source.sourcePath] : undefined,
    historicalEraTag: source.title ?? "baked plate",
  };
  return { ...fitPlate(documentFromLayers(blueprint, archetype, layers)), editingLayer: PLATE_BODY_LAYER[archetype] };
}
