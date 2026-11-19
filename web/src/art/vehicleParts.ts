import {
  ARCHETYPES,
  ARCHETYPE_LAYERS,
  cloneGrid,
  compositeStack,
  emptyGrid,
  layerLabel,
  type LayerStack,
} from "./archetypeLayers";
import { activeEntries, buildAnimationDocument, nearestSlot, withFaction, type UnitPaintDocument } from "./pixelPaint";
import type { PaletteSlotKey, RosterFactionId, SpriteFrameGrid } from "./skeletonSchema";
import { FACTION_MILITARY_MAPPINGS } from "./starterParts";

/**
 * A vehicle, an aircraft, or a ship is a stack of layers, and each layer wears one part.
 * A part is one idle drawing the size of the canvas. Swapping a part changes the idle layer and the
 * other poses are built again from it, so a new turret marches and fires like the old one.
 * The infantry rig does the same job for riflemen in partRig.ts.
 */
export interface VehiclePart {
  id: string;
  name: string;
  /** The layer of the skeleton it is worn on. */
  layer: string;
  /** The idle drawing. The part a layer is wearing is read from the document's idle layer instead. */
  grid: SpriteFrameGrid;
}

/** One vehicle out of the library: a part for each layer and a country's colours, under a name. */
export interface VehicleBuild {
  id: string;
  name: string;
  wearing: Record<string, string>;
  colours: RosterFactionId;
}

export interface VehicleWardrobe {
  parts: VehiclePart[];
  /** The part id each layer wears. */
  wearing: Record<string, string>;
  builds: VehicleBuild[];
}

export const PART_NAME_LIMIT = 40;

/** Whether the document has layers that wear parts. Riflemen keep theirs in the infantry rig. */
export function hasParts(doc: UnitPaintDocument): boolean {
  return doc.layers !== null && doc.archetype !== "infantry";
}

function needParts(doc: UnitPaintDocument): asserts doc is UnitPaintDocument & { layers: NonNullable<UnitPaintDocument["layers"]> } {
  if (!hasParts(doc)) {
    throw new Error("Parts belong to a layered vehicle, aircraft, or ship.");
  }
}

function fits(grid: SpriteFrameGrid, width: number, height: number): boolean {
  return grid.length === height && grid.every((row) => row.length === width);
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function freeId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) {
    return base;
  }
  for (let count = 2; ; count += 1) {
    const id = `${base}_${count}`;
    if (!taken.has(id)) {
      return id;
    }
  }
}

function cleanName(name: string, what: string): string {
  const text = name.trim().replace(/\s+/g, " ");
  if (text === "") {
    throw new Error(`Give the ${what} a name first.`);
  }
  if (text.length > PART_NAME_LIMIT) {
    throw new Error(`A name is ${PART_NAME_LIMIT} characters at most.`);
  }
  return text;
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The parts, with every worn part holding what is on its layer now. A document that has never had
 * a second part gets one part a layer, named for the layer. A part drawn for another canvas size is
 * left out.
 */
export function wardrobeOf(doc: UnitPaintDocument): VehicleWardrobe {
  needParts(doc);
  const { width, height } = doc.blueprint.canvasSize;
  const kept = doc.wardrobe;
  const taken = new Set((kept?.parts ?? []).map((part) => part.id));
  const parts: VehiclePart[] = [];
  const wearing: Record<string, string> = {};
  for (const layer of ARCHETYPE_LAYERS[doc.archetype]) {
    const live = doc.layers.idle[layer] ?? emptyGrid(width, height);
    const own = (kept?.parts ?? []).filter((part) => part.layer === layer);
    const wornId = kept?.wearing[layer];
    if (!own.some((part) => part.id === wornId)) {
      const id = freeId(`${layer}_original`, taken);
      taken.add(id);
      parts.push({ id, name: `Original ${layerLabel(doc.archetype, layer).toLowerCase()}`, layer, grid: live });
      wearing[layer] = id;
    } else if (wornId) {
      wearing[layer] = wornId;
    }
    for (const part of own) {
      if (part.id === wearing[layer]) {
        parts.push({ ...part, grid: live });
      } else if (fits(part.grid, width, height)) {
        parts.push(part);
      }
    }
  }
  return { parts, wearing, builds: kept?.builds ?? [] };
}

export function partsOnLayer(doc: UnitPaintDocument, layer: string): VehiclePart[] {
  return wardrobeOf(doc).parts.filter((part) => part.layer === layer);
}

export function wornVehiclePart(doc: UnitPaintDocument, layer: string): VehiclePart {
  const wardrobe = wardrobeOf(doc);
  const part = wardrobe.parts.find((item) => item.id === wardrobe.wearing[layer]);
  if (!part) {
    throw new Error(`"${layer}" is not a layer of this skeleton.`);
  }
  return part;
}

function withIdle(doc: UnitPaintDocument, idle: LayerStack, wardrobe: VehicleWardrobe): UnitPaintDocument {
  needParts(doc);
  return buildAnimationDocument({ ...doc, layers: { ...doc.layers, idle }, wardrobe });
}

/** Swap the part a layer wears. The other poses are built again from the new idle. */
export function wearVehiclePart(doc: UnitPaintDocument, layer: string, id: string): UnitPaintDocument {
  const wardrobe = wardrobeOf(doc);
  const part = wardrobe.parts.find((item) => item.id === id && item.layer === layer);
  if (!part) {
    throw new Error(`The ${layerLabel(doc.archetype, layer).toLowerCase()} has no part "${id}".`);
  }
  if (wardrobe.wearing[layer] === id) {
    return doc;
  }
  needParts(doc);
  return withIdle(doc, { ...doc.layers.idle, [layer]: part.grid }, { ...wardrobe, wearing: { ...wardrobe.wearing, [layer]: id } });
}

/** Put a new drawing in the library and wear it. */
export function addVehiclePart(doc: UnitPaintDocument, layer: string, name: string, grid: SpriteFrameGrid): UnitPaintDocument {
  const wardrobe = wardrobeOf(doc);
  needParts(doc);
  if (!ARCHETYPE_LAYERS[doc.archetype].includes(layer)) {
    throw new Error(`"${layer}" is not a layer of the ${ARCHETYPES[doc.archetype].label.toLowerCase()} skeleton.`);
  }
  const { width, height } = doc.blueprint.canvasSize;
  if (!fits(grid, width, height)) {
    throw new Error(`The drawing is ${grid[0]?.length ?? 0}×${grid.length}. The canvas is ${width}×${height}.`);
  }
  const label = layerLabel(doc.archetype, layer).toLowerCase();
  const title = cleanName(name, "part");
  if (wardrobe.parts.some((part) => part.layer === layer && sameName(part.name, title))) {
    throw new Error(`The ${label} already has a part called "${title}".`);
  }
  const id = freeId(`${layer}_${slug(title) || "part"}`, new Set(wardrobe.parts.map((part) => part.id)));
  const part: VehiclePart = { id, name: title, layer, grid };
  return withIdle(
    doc,
    { ...doc.layers.idle, [layer]: grid },
    { ...wardrobe, parts: [...wardrobe.parts, part], wearing: { ...wardrobe.wearing, [layer]: id } },
  );
}

/** Copy what a layer wears under a new name and wear the copy, so the first one stays as it is. */
export function copyVehiclePart(doc: UnitPaintDocument, layer: string, name: string): UnitPaintDocument {
  return addVehiclePart(doc, layer, name, cloneGrid(wornVehiclePart(doc, layer).grid));
}

export function renameVehiclePart(doc: UnitPaintDocument, id: string, name: string): UnitPaintDocument {
  const wardrobe = wardrobeOf(doc);
  const part = wardrobe.parts.find((item) => item.id === id);
  if (!part) {
    throw new Error(`There is no part "${id}".`);
  }
  const title = cleanName(name, "part");
  if (wardrobe.parts.some((item) => item.id !== id && item.layer === part.layer && sameName(item.name, title))) {
    throw new Error(`The ${layerLabel(doc.archetype, part.layer).toLowerCase()} already has a part called "${title}".`);
  }
  return { ...doc, wardrobe: { ...wardrobe, parts: wardrobe.parts.map((item) => (item.id === id ? { ...item, name: title } : item)) } };
}

/** Take a part out of the library. A layer keeps at least one. A worn part hands over to its neighbour. */
export function removeVehiclePart(doc: UnitPaintDocument, id: string): UnitPaintDocument {
  const wardrobe = wardrobeOf(doc);
  const part = wardrobe.parts.find((item) => item.id === id);
  if (!part) {
    throw new Error(`There is no part "${id}".`);
  }
  const siblings = wardrobe.parts.filter((item) => item.layer === part.layer);
  if (siblings.length < 2) {
    throw new Error(`The ${layerLabel(doc.archetype, part.layer).toLowerCase()} needs one part. Make another before deleting this one.`);
  }
  const rest = { ...wardrobe, parts: wardrobe.parts.filter((item) => item.id !== id) };
  if (wardrobe.wearing[part.layer] !== id) {
    return { ...doc, wardrobe: rest };
  }
  const at = siblings.findIndex((item) => item.id === id);
  const next = siblings[at - 1] ?? siblings[at + 1];
  if (!next) {
    return doc;
  }
  needParts(doc);
  return withIdle(doc, { ...doc.layers.idle, [part.layer]: next.grid }, { ...rest, wearing: { ...rest.wearing, [part.layer]: next.id } });
}

/** Save what every layer wears, and the country's colours, under a name. A name already in use is saved over. */
export function saveVehicleBuild(doc: UnitPaintDocument, name: string): UnitPaintDocument {
  const wardrobe = wardrobeOf(doc);
  const title = cleanName(name, "build");
  const existing = wardrobe.builds.find((build) => sameName(build.name, title));
  const build: VehicleBuild = {
    id: existing?.id ?? freeId(`build_${slug(title) || "build"}`, new Set(wardrobe.builds.map((item) => item.id))),
    name: title,
    wearing: { ...wardrobe.wearing },
    colours: doc.blueprint.factionId,
  };
  const builds = existing ? wardrobe.builds.map((item) => (item.id === existing.id ? build : item)) : [...wardrobe.builds, build];
  return { ...doc, wardrobe: { ...wardrobe, builds } };
}

/** The layers of a build whose part has been deleted. Those layers keep what they wear. */
export function vehicleBuildGaps(doc: UnitPaintDocument, build: VehicleBuild): string[] {
  const wardrobe = wardrobeOf(doc);
  return ARCHETYPE_LAYERS[doc.archetype].filter(
    (layer) => !wardrobe.parts.some((part) => part.layer === layer && part.id === build.wearing[layer]),
  );
}

/** Put a saved build's parts and colours on. */
export function wearVehicleBuild(doc: UnitPaintDocument, id: string): UnitPaintDocument {
  const wardrobe = wardrobeOf(doc);
  const build = wardrobe.builds.find((item) => item.id === id);
  if (!build) {
    throw new Error(`There is no build "${id}".`);
  }
  needParts(doc);
  const idle: LayerStack = { ...doc.layers.idle };
  const wearing = { ...wardrobe.wearing };
  for (const layer of ARCHETYPE_LAYERS[doc.archetype]) {
    const part = wardrobe.parts.find((item) => item.layer === layer && item.id === build.wearing[layer]);
    if (part) {
      idle[layer] = part.grid;
      wearing[layer] = part.id;
    }
  }
  return withIdle(withFaction(doc, build.colours), idle, { ...wardrobe, wearing });
}

export function removeVehicleBuild(doc: UnitPaintDocument, id: string): UnitPaintDocument {
  const wardrobe = wardrobeOf(doc);
  if (!wardrobe.builds.some((build) => build.id === id)) {
    return doc;
  }
  return { ...doc, wardrobe: { ...wardrobe, builds: wardrobe.builds.filter((build) => build.id !== id) } };
}

/** The saved build that is on now: the same part on every layer, in the same colours. */
export function wornVehicleBuild(doc: UnitPaintDocument): VehicleBuild | null {
  const wardrobe = wardrobeOf(doc);
  return (
    wardrobe.builds.find(
      (build) =>
        build.colours === doc.blueprint.factionId &&
        ARCHETYPE_LAYERS[doc.archetype].every((layer) => build.wearing[layer] === wardrobe.wearing[layer]),
    ) ?? null
  );
}

/** The idle pose as it looks with one layer wearing this drawing. */
export function partPreview(doc: UnitPaintDocument, layer: string, grid: SpriteFrameGrid): SpriteFrameGrid {
  needParts(doc);
  return compositeStack(doc.archetype, { ...doc.layers.idle, [layer]: grid });
}

/** A picture the size of the canvas, snapped to the country's seven slots. Clear pixels stay empty. */
export function gridFromPicture(doc: UnitPaintDocument, rgba: Uint8ClampedArray, width: number, height: number): SpriteFrameGrid {
  const size = doc.blueprint.canvasSize;
  if (width !== size.width || height !== size.height || rgba.length !== width * height * 4) {
    throw new Error(`The picture is ${width}×${height}. A part is the size of the canvas, ${size.width}×${size.height}.`);
  }
  const palette = activeEntries(FACTION_MILITARY_MAPPINGS[doc.blueprint.factionId]);
  const grid: SpriteFrameGrid = [];
  for (let y = 0; y < height; y += 1) {
    const row: (PaletteSlotKey | null)[] = [];
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      row.push((rgba[offset + 3] ?? 0) >= 128 ? nearestSlot(rgba[offset] ?? 0, rgba[offset + 1] ?? 0, rgba[offset + 2] ?? 0, palette) : null);
    }
    grid.push(row);
  }
  return grid;
}
