import { separateFigure, SPRITE_BAKE } from "../ui/map/figureGround";
import { MILITARY } from "../ui/theme/militaryPalette";
import type {
  FactionMilitaryMapping,
  MilitaryStripKey,
  PaletteSlotKey,
  SpriteFrameKey,
  UnitSpriteSheetBlueprint,
  Vec2,
} from "./skeletonSchema";
import { MILITARY_STRIP_KEYS, SPRITE_FRAME_KEYS } from "./skeletonSchema";

const SHEET_MARGIN = 1;

export interface BlockoutRaster {
  albedoKeys: (MilitaryStripKey | null)[];
  sheetBlitOffset: Vec2;
}

export interface CompiledBlockout extends BlockoutRaster {
  canvas: OffscreenCanvas | null;
}

/**
 * Where the blockout's groundOrigin lands on the 80×56 sheet.
 * Throws when that rectangle would touch the outer pixel, which figureGround.ts needs for the ink ring.
 */
export function assertBlockoutFitsSheet(blueprint: UnitSpriteSheetBlueprint): Vec2 {
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

function stripKeyFor(mapping: FactionMilitaryMapping, slot: PaletteSlotKey, militaryStrip: Record<string, string>): MilitaryStripKey {
  const key = mapping[slot];
  if (key === undefined || !Object.prototype.hasOwnProperty.call(militaryStrip, key)) {
    throw new Error(`Slot "${slot}" has no MilitaryStripKey`);
  }
  return key;
}

/**
 * Map one frame's slots onto faction colours. The grid is already flat, so there is no parent walk.
 * Opaque pixels must land inside [1..78, 1..54] once groundOrigin sits on (40, 52).
 */
export function compileBlueprintFrame(
  blueprint: UnitSpriteSheetBlueprint,
  frameKey: SpriteFrameKey,
  factionMapping: FactionMilitaryMapping,
  militaryStrip: Record<MilitaryStripKey, string> = MILITARY,
): CompiledBlockout {
  if (!SPRITE_FRAME_KEYS.includes(frameKey)) {
    throw new Error(`Unknown frame "${frameKey}"`);
  }
  const frame = blueprint.frames[frameKey];
  const { width, height } = blueprint.canvasSize;
  if (!frame || frame.length !== height || frame.some((row) => row.length !== width)) {
    throw new Error(`Frame "${frameKey}" is not a ${width}×${height} grid`);
  }
  const sheetBlitOffset = assertBlockoutFitsSheet(blueprint);
  const albedoKeys: (MilitaryStripKey | null)[] = new Array(width * height).fill(null);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const slot = frame[y]?.[x];
      if (slot == null) {
        continue;
      }
      const sheetX = x + sheetBlitOffset.x;
      const sheetY = y + sheetBlitOffset.y;
      if (sheetX < SHEET_MARGIN || sheetY < SHEET_MARGIN || sheetX > SPRITE_BAKE.width - 1 - SHEET_MARGIN || sheetY > SPRITE_BAKE.height - 1 - SHEET_MARGIN) {
        throw new Error(`Frame "${frameKey}" pixel (${x}, ${y}) leaves the ink margin`);
      }
      albedoKeys[y * width + x] = stripKeyFor(factionMapping, slot, militaryStrip);
    }
  }
  if (typeof OffscreenCanvas === "undefined") {
    return { albedoKeys, sheetBlitOffset, canvas: null };
  }
  const canvas = new OffscreenCanvas(width, height);
  paintAlbedo(canvas, albedoKeys, width, height, militaryStrip);
  return { canvas, albedoKeys, sheetBlitOffset };
}

/** Idle frame, as strip keys. Callers that used to pass a part map now pass the sheet alone. */
export function rasterBlueprintAlbedo(
  blueprint: UnitSpriteSheetBlueprint,
  factionMapping: FactionMilitaryMapping,
): BlockoutRaster {
  const compiled = compileBlueprintFrame(blueprint, "idle", factionMapping);
  return { albedoKeys: compiled.albedoKeys, sheetBlitOffset: compiled.sheetBlitOffset };
}

function paintAlbedo(
  canvas: OffscreenCanvas,
  keys: readonly (MilitaryStripKey | null)[],
  width: number,
  height: number,
  militaryStrip: Record<MilitaryStripKey, string>,
): void {
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
    const hex = militaryStrip[key];
    const rgb = Number.parseInt(hex.slice(1), 16);
    image.data[offset] = (rgb >> 16) & 255;
    image.data[offset + 1] = (rgb >> 8) & 255;
    image.data[offset + 2] = rgb & 255;
    image.data[offset + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * Place the idle frame so groundOrigin sits on sheetFootAnchor, then run figureGround.ts once.
 * The albedo buffer stays free of outline ink so this pass is the only dilation.
 */
export function blitBlueprintToSheet80x56(
  blueprint: UnitSpriteSheetBlueprint,
  factionMapping: FactionMilitaryMapping,
  frameKey: SpriteFrameKey = "idle",
): OffscreenCanvas {
  const compiled = compileBlueprintFrame(blueprint, frameKey, factionMapping);
  if (!compiled.canvas || typeof OffscreenCanvas === "undefined") {
    throw new Error("OffscreenCanvas is not available");
  }
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
