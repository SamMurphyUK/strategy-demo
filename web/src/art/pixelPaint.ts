import { MILITARY } from "../ui/theme/militaryPalette";
import { resolveNodeTransforms } from "./blockoutCompiler";
import { SHEET_FOOT_ANCHOR } from "./skeletonSchema";
import type {
  FactionMilitaryMapping,
  PaletteSlotKey,
  PartAsset,
  RosterFactionId,
  SkeletonNode,
  UnitSkeletonBlueprint,
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

export type Brush = PaletteSlotKey | "eraser";

export interface UnitPaintFile {
  kind: "unit-paint";
  version: 1;
  flat: boolean;
  blueprint: UnitSkeletonBlueprint;
  parts: PartAsset[];
}

export interface UnitPaintDocument {
  blueprint: UnitSkeletonBlueprint;
  parts: Record<string, PartAsset>;
  editingNodeId: string;
  flat: boolean;
}

const CANVAS = 48;

export function slotHex(mapping: FactionMilitaryMapping, slot: PaletteSlotKey): string {
  return MILITARY[mapping[slot]];
}

export function documentFromBlueprint(
  blueprint: UnitSkeletonBlueprint,
  parts: Record<string, PartAsset>,
): UnitPaintDocument {
  const used = new Set(blueprint.nodes.map((node) => node.partId));
  const cloned: Record<string, PartAsset> = {};
  for (const partId of used) {
    const part = parts[partId];
    if (!part) {
      throw new Error(`Blueprint "${blueprint.blueprintId}" is missing part "${partId}"`);
    }
    cloned[partId] = clonePart(part);
  }
  const nodes = blueprint.nodes.map(cloneNode);
  return {
    blueprint: {
      ...blueprint,
      groundOrigin: { ...blueprint.groundOrigin },
      sheetFootAnchor: { ...blueprint.sheetFootAnchor },
      muzzlePoint: blueprint.muzzlePoint ? { ...blueprint.muzzlePoint } : undefined,
      nodes,
    },
    parts: cloned,
    editingNodeId: nodes[0]?.nodeId ?? "",
    flat: false,
  };
}

export function blankDocument(factionId: RosterFactionId): UnitPaintDocument {
  const partId = "custom_flat";
  const grid = emptyGrid(CANVAS, CANVAS);
  return {
    blueprint: {
      blueprintId: "custom_unit",
      unitTypeId: "infantry",
      factionId,
      category: "land",
      canvasSize: { width: CANVAS, height: CANVAS },
      groundOrigin: { x: 24, y: 45 },
      sheetFootAnchor: { ...SHEET_FOOT_ANCHOR },
      muzzlePoint: { x: 36, y: 24 },
      nativeFacing: "right",
      historicalEraTag: "custom unit",
      nodes: [
        {
          nodeId: "flat",
          partId,
          parentId: null,
          anchorInParent: { x: 0, y: 0 },
          rotationDeg: 0,
          zIndex: 0,
        },
      ],
    },
    parts: {
      [partId]: {
        partId,
        slotType: "hull",
        label: "Custom figure",
        width: CANVAS,
        height: CANVAS,
        localPivot: { x: 24, y: 45 },
        pixelGrid: grid,
        promptFragment: "custom painted figure",
      },
    },
    editingNodeId: "flat",
    flat: true,
  };
}

/** Faction changes the swatches. The slot grid stays put. */
export function withFaction(doc: UnitPaintDocument, factionId: RosterFactionId): UnitPaintDocument {
  return { ...doc, blueprint: { ...doc.blueprint, factionId } };
}

export function withEditingNode(doc: UnitPaintDocument, nodeId: string): UnitPaintDocument {
  if (!doc.blueprint.nodes.some((node) => node.nodeId === nodeId)) {
    return doc;
  }
  return { ...doc, editingNodeId: nodeId };
}

/**
 * Move the foot pin without sliding the painted pixels.
 * Root anchors take the opposite shift, so the sheet foot changes and the figure stays.
 */
export function placeGroundOrigin(doc: UnitPaintDocument, x: number, y: number): UnitPaintDocument {
  if (!insideCanvas(doc, x, y)) {
    return doc;
  }
  const dx = x - doc.blueprint.groundOrigin.x;
  const dy = y - doc.blueprint.groundOrigin.y;
  return {
    ...doc,
    blueprint: {
      ...doc.blueprint,
      groundOrigin: { x, y },
      nodes: doc.blueprint.nodes.map((node) =>
        node.parentId === null
          ? { ...node, anchorInParent: { x: node.anchorInParent.x - dx, y: node.anchorInParent.y - dy } }
          : node,
      ),
    },
  };
}

export function placeMuzzle(doc: UnitPaintDocument, x: number, y: number): UnitPaintDocument {
  if (!insideCanvas(doc, x, y)) {
    return doc;
  }
  return { ...doc, blueprint: { ...doc.blueprint, muzzlePoint: { x, y } } };
}

export function partCellAt(
  doc: UnitPaintDocument,
  nodeId: string,
  canvasX: number,
  canvasY: number,
): { x: number; y: number } | null {
  const resolved = resolveNodeTransforms(doc.blueprint).get(nodeId);
  const part = resolved ? doc.parts[resolved.node.partId] : undefined;
  if (!resolved || !part) {
    return null;
  }
  const cos = Math.cos(resolved.rotRad);
  const sin = Math.sin(resolved.rotRad);
  const relX = canvasX - resolved.worldPivot.x;
  const relY = canvasY - resolved.worldPivot.y;
  const srcX = Math.round(relX * cos + relY * sin + part.localPivot.x);
  const srcY = Math.round(-relX * sin + relY * cos + part.localPivot.y);
  if (srcX < 0 || srcY < 0 || srcX >= part.width || srcY >= part.height) {
    return null;
  }
  return { x: srcX, y: srcY };
}

/** Paint one cell of the part under the brush. Other parts, including a turret or barrel, stay as they are. */
export function paintAt(doc: UnitPaintDocument, canvasX: number, canvasY: number, brush: Brush): UnitPaintDocument {
  const cell = partCellAt(doc, doc.editingNodeId, canvasX, canvasY);
  const node = doc.blueprint.nodes.find((item) => item.nodeId === doc.editingNodeId);
  if (!cell || !node) {
    return doc;
  }
  const part = doc.parts[node.partId];
  if (!part) {
    return doc;
  }
  const next = clonePart(part);
  next.pixelGrid[cell.y][cell.x] = brush === "eraser" ? null : brush;
  return { ...doc, parts: { ...doc.parts, [part.partId]: next } };
}

/** Collapse every part into one 48×48 grid. Articulation is not on this flat figure. */
export function flattenBlockout(doc: UnitPaintDocument): UnitPaintDocument {
  const grid = slotGrid(doc);
  return documentFromFlatGrid(doc.blueprint, grid);
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
  const grid: (PaletteSlotKey | null)[][] = [];
  for (let y = 0; y < height; y++) {
    const row: (PaletteSlotKey | null)[] = [];
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      row.push(rgba[offset + 3] >= 128 ? nearestSlot(rgba[offset], rgba[offset + 1], rgba[offset + 2], palette) : null);
    }
    grid.push(row);
  }
  return documentFromFlatGrid(doc.blueprint, grid);
}

export function toPaintFile(doc: UnitPaintDocument): UnitPaintFile {
  return {
    kind: "unit-paint",
    version: 1,
    flat: doc.flat,
    blueprint: doc.blueprint,
    parts: Object.values(doc.parts),
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
  if (!Array.isArray(value.parts)) {
    throw new Error("The unit JSON is missing its parts.");
  }
  const parts: Record<string, PartAsset> = {};
  for (const part of value.parts) {
    if (!isPart(part)) {
      throw new Error("A part in the unit JSON has no pixel grid.");
    }
    parts[part.partId] = part;
  }
  for (const node of blueprint.nodes) {
    if (!parts[node.partId]) {
      throw new Error(`Node "${node.nodeId}" is missing part "${node.partId}".`);
    }
  }
  return {
    blueprint,
    parts,
    editingNodeId: blueprint.nodes[0]?.nodeId ?? "",
    flat: value.flat === true,
  };
}

function documentFromFlatGrid(blueprint: UnitSkeletonBlueprint, grid: (PaletteSlotKey | null)[][]): UnitPaintDocument {
  const partId = `${blueprint.blueprintId}_flat`;
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  return {
    blueprint: {
      ...blueprint,
      canvasSize: { width: CANVAS, height: CANVAS },
      sheetFootAnchor: { ...SHEET_FOOT_ANCHOR },
      nodes: [
        {
          nodeId: "flat",
          partId,
          parentId: null,
          anchorInParent: { x: 0, y: 0 },
          rotationDeg: 0,
          zIndex: 0,
        },
      ],
    },
    parts: {
      [partId]: {
        partId,
        slotType: "hull",
        label: "Flattened figure",
        width,
        height,
        localPivot: { ...blueprint.groundOrigin },
        pixelGrid: grid.map((row) => row.slice()),
        promptFragment: blueprint.historicalEraTag,
      },
    },
    editingNodeId: "flat",
    flat: true,
  };
}

function slotGrid(doc: UnitPaintDocument): (PaletteSlotKey | null)[][] {
  const { width, height } = doc.blueprint.canvasSize;
  const resolved = resolveNodeTransforms(doc.blueprint);
  const paintOrder = [...resolved.values()].sort((a, b) => a.node.zIndex - b.node.zIndex);
  const slots: (PaletteSlotKey | null)[] = new Array(width * height).fill(null);
  for (const entry of paintOrder) {
    const part = doc.parts[entry.node.partId];
    if (!part) {
      continue;
    }
    const cos = Math.cos(entry.rotRad);
    const sin = Math.sin(entry.rotRad);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const relX = x - entry.worldPivot.x;
        const relY = y - entry.worldPivot.y;
        const srcX = Math.round(relX * cos + relY * sin + part.localPivot.x);
        const srcY = Math.round(-relX * sin + relY * cos + part.localPivot.y);
        if (srcX < 0 || srcY < 0 || srcX >= part.width || srcY >= part.height) {
          continue;
        }
        const slot = part.pixelGrid[srcY]?.[srcX];
        if (slot == null) {
          continue;
        }
        slots[y * width + x] = entry.node.slotOverrides?.[slot] ?? slot;
      }
    }
  }
  const rows: (PaletteSlotKey | null)[][] = [];
  for (let y = 0; y < height; y++) {
    rows.push(slots.slice(y * width, (y + 1) * width));
  }
  return rows;
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

function emptyGrid(width: number, height: number): (PaletteSlotKey | null)[][] {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => null));
}

function clonePart(part: PartAsset): PartAsset {
  return {
    ...part,
    localPivot: { ...part.localPivot },
    pixelGrid: part.pixelGrid.map((row) => row.slice()),
  };
}

function cloneNode(node: SkeletonNode): SkeletonNode {
  return {
    ...node,
    anchorInParent: { ...node.anchorInParent },
    articulation: node.articulation
      ? { ...node.articulation, pivotOffset: { ...node.articulation.pivotOffset } }
      : undefined,
    slotOverrides: node.slotOverrides ? { ...node.slotOverrides } : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBlueprint(value: unknown): value is UnitSkeletonBlueprint {
  if (!isRecord(value) || !isRecord(value.canvasSize) || !Array.isArray(value.nodes)) {
    return false;
  }
  return (
    typeof value.blueprintId === "string" &&
    typeof value.factionId === "string" &&
    ROSTER_FACTIONS.includes(value.factionId as RosterFactionId) &&
    isVec(value.groundOrigin)
  );
}

function isPart(value: unknown): value is PartAsset {
  if (!isRecord(value) || typeof value.partId !== "string" || !Array.isArray(value.pixelGrid)) {
    return false;
  }
  const width = value.width;
  const height = value.height;
  if (typeof width !== "number" || typeof height !== "number" || value.pixelGrid.length !== height) {
    return false;
  }
  return value.pixelGrid.every((row) => Array.isArray(row) && row.length === width);
}

function isVec(value: unknown): value is Vec2 {
  return isRecord(value) && typeof value.x === "number" && typeof value.y === "number";
}
