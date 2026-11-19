import { SPRITE_BAKE } from "../ui/map/figureGround";
import { MILITARY } from "../ui/theme/militaryPalette";
import type {
  FactionMilitaryMapping,
  MilitaryStripKey,
  PaletteSlotKey,
  SpriteFrameKey,
  UnitSpriteSheetBlueprint,
  Vec2,
} from "./skeletonSchema";
import { MILITARY_STRIP_KEYS, SPRITE_FRAME_KEYS, stripKeyOfSlot } from "./skeletonSchema";

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

/** What the card needs to know about a plate: where its ground point is and how far it is scaled down. */
export interface CardPlacement {
  groundOrigin: Vec2;
  sheetFootAnchor: Vec2;
  displayDivisor?: number;
}

/** Whole plate pixels to one card pixel. A blueprint without a divisor is drawn at its own size. */
export function divisorOf(placement: { displayDivisor?: number }): number {
  const divisor = placement.displayDivisor ?? 1;
  if (!Number.isInteger(divisor) || divisor < 1) {
    throw new Error(`displayDivisor ${divisor} must be a whole number of 1 or more`);
  }
  return divisor;
}

/**
 * The card pixel a plate pixel lands on. The grid of blocks hangs from the ground point: the ground
 * row is the bottom row of its block, and the ground column is the left column of its block. The feet
 * therefore stay on the foot anchor at every divisor.
 */
export function cardCell(placement: CardPlacement, x: number, y: number): Vec2 {
  const divisor = divisorOf(placement);
  return {
    x: placement.sheetFootAnchor.x + Math.floor((x - placement.groundOrigin.x) / divisor),
    y: placement.sheetFootAnchor.y + Math.ceil((y - placement.groundOrigin.y) / divisor),
  };
}

/** The plate pixel a card pixel shows: the middle of its block. This is the nearest-neighbour sample. */
export function plateSample(placement: CardPlacement, cardX: number, cardY: number): Vec2 {
  const divisor = divisorOf(placement);
  const middle = Math.floor(divisor / 2);
  return {
    x: placement.groundOrigin.x + (cardX - placement.sheetFootAnchor.x) * divisor + middle,
    y: placement.groundOrigin.y + (cardY - placement.sheetFootAnchor.y) * divisor - (divisor - 1) + middle,
  };
}

function insideInkMargin(cell: Vec2): boolean {
  return (
    cell.x >= SHEET_MARGIN &&
    cell.y >= SHEET_MARGIN &&
    cell.x <= SPRITE_BAKE.width - 1 - SHEET_MARGIN &&
    cell.y <= SPRITE_BAKE.height - 1 - SHEET_MARGIN
  );
}

/** The first painted pixel that would land on the card's outer pixel or off the card, or null when the pose fits. */
export function firstPixelOffCard(grid: readonly (readonly (unknown | null)[])[], placement: CardPlacement): Vec2 | null {
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y] ?? [];
    for (let x = 0; x < row.length; x++) {
      if (row[x] != null && !insideInkMargin(cardCell(placement, x, y))) {
        return { x, y };
      }
    }
  }
  return null;
}

/**
 * One pose scaled onto the 80×56 card, as slots. Each card pixel takes the middle of its block.
 * The outline is not here. figureGround.ts paints it when the card is drawn.
 */
export function rasterCardSlots(
  grid: readonly (readonly (PaletteSlotKey | null)[])[],
  placement: CardPlacement,
): (PaletteSlotKey | null)[] {
  const slots: (PaletteSlotKey | null)[] = new Array(SPRITE_BAKE.width * SPRITE_BAKE.height).fill(null);
  for (let cardY = 0; cardY < SPRITE_BAKE.height; cardY++) {
    for (let cardX = 0; cardX < SPRITE_BAKE.width; cardX++) {
      const sample = plateSample(placement, cardX, cardY);
      slots[cardY * SPRITE_BAKE.width + cardX] = grid[sample.y]?.[sample.x] ?? null;
    }
  }
  return slots;
}

/** One frame scaled onto the 80×56 card, as strip keys. Throws when the frame leaves the ink margin. */
export function rasterCardAlbedo(
  blueprint: UnitSpriteSheetBlueprint,
  frameKey: SpriteFrameKey,
  factionMapping: FactionMilitaryMapping,
  militaryStrip: Record<MilitaryStripKey, string> = MILITARY,
): (MilitaryStripKey | null)[] {
  const frame = blueprint.frames[frameKey];
  const off = firstPixelOffCard(frame, blueprint);
  if (off) {
    throw new Error(`Frame "${frameKey}" pixel (${off.x}, ${off.y}) leaves the ink margin`);
  }
  return rasterCardSlots(frame, blueprint).map((slot) => (slot == null ? null : stripKeyFor(factionMapping, slot, militaryStrip)));
}

function assertGroundOnPlate(blueprint: UnitSpriteSheetBlueprint): void {
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
}

function stripKeyFor(mapping: FactionMilitaryMapping, slot: PaletteSlotKey, militaryStrip: Record<string, string>): MilitaryStripKey {
  const key = stripKeyOfSlot(mapping, slot);
  if (key === undefined || !Object.prototype.hasOwnProperty.call(militaryStrip, key)) {
    throw new Error(`Slot "${slot}" has no MilitaryStripKey`);
  }
  return key;
}

/**
 * Map one frame's slots onto faction colours. The grid is already flat, so there is no parent walk.
 * Opaque pixels must land inside [1..78, 1..54] once groundOrigin sits on (40, 52).
 * A blueprint with a displayDivisor is a plate: its canvas may be larger than the card, and each pixel
 * is checked where the divisor puts it. The keys that come back are at the plate's own size.
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
  const plate = blueprint.displayDivisor !== undefined;
  if (plate) {
    assertGroundOnPlate(blueprint);
  }
  const sheetBlitOffset = plate ? cardCell(blueprint, 0, 0) : assertBlockoutFitsSheet(blueprint);
  const albedoKeys: (MilitaryStripKey | null)[] = new Array(width * height).fill(null);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const slot = frame[y]?.[x];
      if (slot == null) {
        continue;
      }
      const cell = plate ? cardCell(blueprint, x, y) : { x: x + sheetBlitOffset.x, y: y + sheetBlitOffset.y };
      if (!insideInkMargin(cell)) {
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

/** Place the frame so groundOrigin sits on sheetFootAnchor. The figure is the painted pixels, with no ink ring. */
export function blitBlueprintToSheet80x56(
  blueprint: UnitSpriteSheetBlueprint,
  factionMapping: FactionMilitaryMapping,
  frameKey: SpriteFrameKey = "idle",
): OffscreenCanvas {
  if (blueprint.displayDivisor !== undefined) {
    if (typeof OffscreenCanvas === "undefined") {
      throw new Error("OffscreenCanvas is not available");
    }
    const card = new OffscreenCanvas(SPRITE_BAKE.width, SPRITE_BAKE.height);
    paintAlbedo(card, rasterCardAlbedo(blueprint, frameKey, factionMapping), SPRITE_BAKE.width, SPRITE_BAKE.height, MILITARY);
    return card;
  }
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
