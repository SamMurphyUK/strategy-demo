import { separateFigure, SPRITE_BAKE } from "../ui/map/figureGround";
import { MILITARY } from "../ui/theme/militaryPalette";
import type {
  FactionMilitaryMapping,
  MilitaryStripKey,
  PaletteSlotKey,
  SkeletonNode,
  UnitSkeletonBlueprint,
  Vec2,
} from "./skeletonSchema";
import { MILITARY_STRIP_KEYS } from "./skeletonSchema";

const SHEET_MARGIN = 1;

export interface ResolvedNode {
  node: SkeletonNode;
  worldPivot: Vec2;
  rotRad: number;
}

export interface BlockoutRaster {
  albedoKeys: (MilitaryStripKey | null)[];
  sheetBlitOffset: Vec2;
}

export interface CompiledBlockout extends BlockoutRaster {
  canvas: OffscreenCanvas;
}

interface PlacedPart {
  node: SkeletonNode;
  worldPivot: Vec2;
  rotRad: number;
  cos: number;
  sin: number;
}

/**
 * Where the blockout's groundOrigin lands on the 80×56 sheet.
 * Throws when that rectangle would touch the outer pixel, which figureGround.ts needs for the ink ring.
 */
export function assertBlockoutFitsSheet(blueprint: UnitSkeletonBlueprint): Vec2 {
  const { width, height } = blueprint.canvasSize;
  const { x: footX, y: footY } = blueprint.groundOrigin;
  if (!Number.isInteger(footX) || !Number.isInteger(footY)) {
    throw new Error("groundOrigin must land on a whole pixel");
  }
  if (footX < 0 || footY < 0 || footX >= width || footY >= height) {
    throw new Error(`groundOrigin (${footX}, ${footY}) is outside the ${width}×${height} blockout`);
  }
  const anchor = blueprint.sheetFootAnchor;
  if (!Number.isInteger(anchor.x) || !Number.isInteger(anchor.y)) {
    throw new Error("sheetFootAnchor must land on a whole pixel");
  }
  const offset = { x: anchor.x - footX, y: anchor.y - footY };
  const sheetW = SPRITE_BAKE.width;
  const sheetH = SPRITE_BAKE.height;
  const x0 = offset.x;
  const y0 = offset.y;
  const x1 = offset.x + width;
  const y1 = offset.y + height;
  if (x0 < SHEET_MARGIN || y0 < SHEET_MARGIN || x1 > sheetW - SHEET_MARGIN || y1 > sheetH - SHEET_MARGIN) {
    throw new Error(
      `Blockout ${width}×${height} placed at (${x0}, ${y0}) leaves the ${sheetW}×${sheetH} sheet. ` +
        `Keep a ${SHEET_MARGIN}px margin around sheet foot (${anchor.x}, ${anchor.y}) so the ink outline fits.`,
    );
  }
  return offset;
}

/**
 * Parents first, then children. A cycle or a missing parent throws.
 * zIndex is not a parent order: a child with a lower zIndex still hangs off its parent.
 */
export function resolveNodeTransforms(blueprint: UnitSkeletonBlueprint): Map<string, ResolvedNode> {
  const nodeById = new Map<string, SkeletonNode>();
  for (const node of blueprint.nodes) {
    if (nodeById.has(node.nodeId)) {
      throw new Error(`Skeleton node "${node.nodeId}" is listed twice`);
    }
    nodeById.set(node.nodeId, node);
  }

  const resolved = new Map<string, ResolvedNode>();
  const visiting = new Set<string>();

  const visit = (nodeId: string): ResolvedNode => {
    const cached = resolved.get(nodeId);
    if (cached) {
      return cached;
    }
    const node = nodeById.get(nodeId);
    if (!node) {
      throw new Error(`Skeleton node "${nodeId}" is missing`);
    }
    if (visiting.has(nodeId)) {
      throw new Error(`Skeleton cycle at node "${nodeId}"`);
    }
    visiting.add(nodeId);

    let parentPivot: Vec2;
    let parentRot = 0;
    if (node.parentId === null) {
      parentPivot = blueprint.groundOrigin;
    } else {
      if (!nodeById.has(node.parentId)) {
        throw new Error(`Skeleton node "${nodeId}" parents missing node "${node.parentId}"`);
      }
      const parent = visit(node.parentId);
      parentPivot = parent.worldPivot;
      parentRot = parent.rotRad;
    }

    const cos = Math.cos(parentRot);
    const sin = Math.sin(parentRot);
    const { x: ax, y: ay } = node.anchorInParent;
    const worldPivot = {
      x: parentPivot.x + ax * cos - ay * sin,
      y: parentPivot.y + ax * sin + ay * cos,
    };
    const entry: ResolvedNode = {
      node,
      worldPivot,
      rotRad: parentRot + (node.rotationDeg * Math.PI) / 180,
    };
    visiting.delete(nodeId);
    resolved.set(nodeId, entry);
    return entry;
  };

  for (const node of blueprint.nodes) {
    visit(node.nodeId);
  }
  return resolved;
}

function slotKey(node: SkeletonNode, slot: PaletteSlotKey): PaletteSlotKey {
  return node.slotOverrides?.[slot] ?? slot;
}

function stripKeyFor(
  mapping: FactionMilitaryMapping,
  node: SkeletonNode,
  slot: PaletteSlotKey,
): MilitaryStripKey {
  const key = mapping[slotKey(node, slot)];
  if (key === undefined || !Object.prototype.hasOwnProperty.call(MILITARY, key)) {
    throw new Error(`Skeleton node "${node.nodeId}" has no MilitaryStripKey for slot "${slot}"`);
  }
  return key;
}

/**
 * Inverse-sampled flat albedo. Destination pixels look up a source pixel, so a rotated solid
 * rectangle does not punch holes the way a forward round-and-stamp does.
 * No outline ink is written here.
 */
export function rasterBlueprintAlbedo(
  blueprint: UnitSkeletonBlueprint,
  partAssets: Map<string, { width: number; height: number; localPivot: Vec2; pixelGrid: (PaletteSlotKey | null)[][] }>,
  factionMapping: FactionMilitaryMapping,
): BlockoutRaster {
  const sheetBlitOffset = assertBlockoutFitsSheet(blueprint);
  const { width, height } = blueprint.canvasSize;
  const resolved = resolveNodeTransforms(blueprint);
  const paintOrder = [...resolved.values()].sort((a, b) => a.node.zIndex - b.node.zIndex);

  const albedoKeys: (MilitaryStripKey | null)[] = new Array(width * height).fill(null);

  for (const entry of paintOrder) {
    const part = partAssets.get(entry.node.partId);
    if (!part) {
      throw new Error(`Skeleton node "${entry.node.nodeId}" references missing part "${entry.node.partId}"`);
    }
    if (part.pixelGrid.length !== part.height || part.pixelGrid.some((row) => row.length !== part.width)) {
      throw new Error(`Part "${entry.node.partId}" pixelGrid does not match ${part.width}×${part.height}`);
    }
    const placed: PlacedPart = {
      node: entry.node,
      worldPivot: entry.worldPivot,
      rotRad: entry.rotRad,
      cos: Math.cos(entry.rotRad),
      sin: Math.sin(entry.rotRad),
    };
    stampPart(albedoKeys, width, height, placed, part, factionMapping);
  }

  return { albedoKeys, sheetBlitOffset };
}

function stampPart(
  albedoKeys: (MilitaryStripKey | null)[],
  canvasW: number,
  canvasH: number,
  placed: PlacedPart,
  part: { width: number; height: number; localPivot: Vec2; pixelGrid: (PaletteSlotKey | null)[][] },
  factionMapping: FactionMilitaryMapping,
): void {
  const { cos, sin, worldPivot, node } = placed;
  const { x: pivotX, y: pivotY } = part.localPivot;
  const corners = [
    { x: 0, y: 0 },
    { x: part.width - 1, y: 0 },
    { x: 0, y: part.height - 1 },
    { x: part.width - 1, y: part.height - 1 },
  ];
  let minX = canvasW;
  let minY = canvasH;
  let maxX = -1;
  let maxY = -1;
  for (const corner of corners) {
    const dx = corner.x - pivotX;
    const dy = corner.y - pivotY;
    const destX = worldPivot.x + dx * cos - dy * sin;
    const destY = worldPivot.y + dx * sin + dy * cos;
    minX = Math.min(minX, destX);
    minY = Math.min(minY, destY);
    maxX = Math.max(maxX, destX);
    maxY = Math.max(maxY, destY);
  }
  const xStart = Math.max(0, Math.floor(minX) - 1);
  const yStart = Math.max(0, Math.floor(minY) - 1);
  const xEnd = Math.min(canvasW - 1, Math.ceil(maxX) + 1);
  const yEnd = Math.min(canvasH - 1, Math.ceil(maxY) + 1);

  for (let y = yStart; y <= yEnd; y++) {
    for (let x = xStart; x <= xEnd; x++) {
      const relX = x - worldPivot.x;
      const relY = y - worldPivot.y;
      const srcX = Math.round(relX * cos + relY * sin + pivotX);
      const srcY = Math.round(-relX * sin + relY * cos + pivotY);
      if (srcX < 0 || srcY < 0 || srcX >= part.width || srcY >= part.height) {
        continue;
      }
      const slot = part.pixelGrid[srcY]?.[srcX];
      if (slot == null) {
        continue;
      }
      albedoKeys[y * canvasW + x] = stripKeyFor(factionMapping, node, slot);
    }
  }
}

function paintAlbedo(canvas: OffscreenCanvas, keys: readonly (MilitaryStripKey | null)[], width: number, height: number): void {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("The blockout canvas has no 2D context");
  }
  ctx.imageSmoothingEnabled = false;
  const image = ctx.getImageData(0, 0, width, height);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const offset = i * 4;
    if (key == null) {
      image.data[offset + 3] = 0;
      continue;
    }
    const hex = MILITARY[key];
    const rgb = Number.parseInt(hex.slice(1), 16);
    image.data[offset] = (rgb >> 16) & 255;
    image.data[offset + 1] = (rgb >> 8) & 255;
    image.data[offset + 2] = rgb & 255;
    image.data[offset + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

/** Rasterise the rest pose, then paint it. Articulation is stored on the nodes and is not applied here. */
export function compileBlueprintBlockout(
  blueprint: UnitSkeletonBlueprint,
  partAssets: Map<string, { width: number; height: number; localPivot: Vec2; pixelGrid: (PaletteSlotKey | null)[][] }>,
  factionMapping: FactionMilitaryMapping,
): CompiledBlockout {
  const raster = rasterBlueprintAlbedo(blueprint, partAssets, factionMapping);
  if (typeof OffscreenCanvas === "undefined") {
    throw new Error("OffscreenCanvas is not available");
  }
  const { width, height } = blueprint.canvasSize;
  const canvas = new OffscreenCanvas(width, height);
  paintAlbedo(canvas, raster.albedoKeys, width, height);
  return { canvas, albedoKeys: raster.albedoKeys, sheetBlitOffset: raster.sheetBlitOffset };
}

/**
 * Place the blockout so groundOrigin sits on sheetFootAnchor, then run figureGround.ts once.
 * The albedo buffer stays free of outline ink so this pass is the only dilation.
 */
export function blitBlueprintToSheet80x56(
  blueprint: UnitSkeletonBlueprint,
  partAssets: Map<string, { width: number; height: number; localPivot: Vec2; pixelGrid: (PaletteSlotKey | null)[][] }>,
  factionMapping: FactionMilitaryMapping,
): OffscreenCanvas {
  const compiled = compileBlueprintBlockout(blueprint, partAssets, factionMapping);
  const sheet = new OffscreenCanvas(SPRITE_BAKE.width, SPRITE_BAKE.height);
  const ctx = sheet.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("The sprite sheet has no 2D context");
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(compiled.canvas, compiled.sheetBlitOffset.x, compiled.sheetBlitOffset.y);
  const image = ctx.getImageData(0, 0, SPRITE_BAKE.width, SPRITE_BAKE.height);
  separateFigure(image.data, SPRITE_BAKE.width, SPRITE_BAKE.height);
  ctx.putImageData(image, 0, 0);
  return sheet;
}

function hexChannels(hex: string): [number, number, number] {
  const rgb = Number.parseInt(hex.slice(1), 16);
  return [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255];
}

function nearestStripKey(
  r: number,
  g: number,
  b: number,
  palette: readonly { key: MilitaryStripKey; r: number; g: number; b: number }[],
): MilitaryStripKey {
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
  if (!best) {
    throw new Error("The military strip is empty");
  }
  return best.key;
}

export interface CandidateEvaluation {
  quantizedKeys: (MilitaryStripKey | null)[];
  silhouetteIoU: number;
}

/**
 * Snap an unquantized candidate onto the strip and score its silhouette against the blockout.
 * Throws when the candidate's pixel count does not match the blockout. The IoU is a number for a person to read.
 */
export function evaluateCandidateAgainstBlockout(
  candidate: ImageData,
  blockoutWidth: number,
  blockoutHeight: number,
  albedoKeys: readonly (MilitaryStripKey | null)[],
  militaryStrip: Record<MilitaryStripKey, string> = MILITARY,
): CandidateEvaluation {
  const pixels = blockoutWidth * blockoutHeight;
  if (
    candidate.width !== blockoutWidth ||
    candidate.height !== blockoutHeight ||
    albedoKeys.length !== pixels ||
    candidate.data.length !== pixels * 4
  ) {
    throw new Error(
      `Candidate ${candidate.width}×${candidate.height} does not match blockout ${blockoutWidth}×${blockoutHeight}`,
    );
  }
  const palette = MILITARY_STRIP_KEYS.filter((key) => militaryStrip[key] !== undefined).map((key) => {
    const [r, g, b] = hexChannels(militaryStrip[key]);
    return { key, r, g, b };
  });
  if (palette.length === 0) {
    throw new Error("The military strip is empty");
  }

  const quantizedKeys: (MilitaryStripKey | null)[] = new Array(pixels);
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < pixels; i++) {
    const offset = i * 4;
    const candidateOpaque = candidate.data[offset + 3] >= 128;
    const blockoutOpaque = albedoKeys[i] != null;
    if (candidateOpaque && blockoutOpaque) {
      intersection += 1;
    }
    if (candidateOpaque || blockoutOpaque) {
      union += 1;
    }
    quantizedKeys[i] = candidateOpaque
      ? nearestStripKey(candidate.data[offset], candidate.data[offset + 1], candidate.data[offset + 2], palette)
      : null;
  }
  return {
    quantizedKeys,
    silhouetteIoU: union === 0 ? 1 : intersection / union,
  };
}
