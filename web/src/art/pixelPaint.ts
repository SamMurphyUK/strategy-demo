import {
  ARCHETYPES,
  ARCHETYPE_LAYERS,
  archetypeForUnitType,
  buildAnimation,
  cloneFrames,
  cloneStack,
  emptyFrames,
  flattenFrames,
  isArchetype,
  type ArchetypeKey,
  type LayerFrames,
} from "./archetypeLayers";
import { ARCHETYPE_STARTERS, archetypeStarter } from "./archetypeStarters";
import {
  cloneLayerStack,
  gridHasInk,
  shiftGrid,
  emptyLayerStack,
  type InfantryLayerKey,
  type InfantryLayerStack,
} from "./infantryMarch";
import { MILITARY } from "../ui/theme/militaryPalette";
import { layoutWalkGrid, type PartCategory } from "./paperDoll";
import { STARTER_BLUEPRINTS, STARTER_INFANTRY_LAYERS } from "./starterParts";
import { MILITARY_STRIP_KEYS, SHEET_FOOT_ANCHOR, SPRITE_FRAME_KEYS } from "./skeletonSchema";
import type {
  FactionMilitaryMapping,
  MilitaryStripKey,
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
}

const CANVAS = 48;

export function slotHex(mapping: FactionMilitaryMapping, slot: PaletteSlotKey): string {
  return MILITARY[mapping[slot]];
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

/** The six riflemen, then one layered starter for each other skeleton, then the flat tanks of the other countries. */
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
  const layers = buildAnimation(doc.archetype, doc.layers, {
    unitTypeId: doc.blueprint.unitTypeId,
    groundX: doc.blueprint.groundOrigin.x,
    muzzlePoint: doc.blueprint.muzzlePoint ?? null,
  });
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
    const layers = cloneFrames(doc.archetype, doc.layers);
    const stack = layers[doc.editingFrame];
    if (brush === "eraser") {
      let changed = false;
      for (const layer of ARCHETYPE_LAYERS[doc.archetype]) {
        const row = stack[layer]?.[canvasY];
        if (row && row[canvasX] != null) {
          row[canvasX] = null;
          changed = true;
        }
      }
      return changed ? withLayers(doc, layers, doc.editingFrame) : doc;
    }
    const row = stack[doc.editingLayer]?.[canvasY];
    if (!row) {
      return doc;
    }
    row[canvasX] = slot;
    return withLayers(doc, layers, doc.editingFrame);
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

function activeEntries(mapping: FactionMilitaryMapping): { slot: PaletteSlotKey; r: number; g: number; b: number }[] {
  return PALETTE_SLOT_KEYS.map((slot) => {
    const rgb = Number.parseInt(MILITARY[mapping[slot]].slice(1), 16);
    return { slot, r: (rgb >> 16) & 255, g: (rgb >> 8) & 255, b: rgb & 255 };
  });
}

function nearestSlot(
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
