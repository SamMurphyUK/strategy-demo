import { MILITARY } from "../ui/theme/militaryPalette";
import { emblemBitmap, emblemById, emblemCells, type Emblem, type EmblemBitmap, type EmblemId, type StampCell } from "./emblems";
import { EMBLEM_STRIP, type EmblemSlotKey } from "./skeletonSchema";

/**
 * Emblems on the large polished sprites: pure data and compositing, no DOM.
 *
 * The polished PNG is never written. The placements sit beside it in <stem>.stamps.json, in sprite
 * pixels. npm run stamp:units composites them into <stem>.outlined.stamped.png, and
 * npm run vectorize:units -- --stamped traces that into <stem>.stamped.svg.
 */

export const POLISHED_PNG_SUFFIX = ".outlined.polished.png";
export const STAMPED_PNG_SUFFIX = ".outlined.stamped.png";
export const STAMPS_SUFFIX = ".stamps.json";
/** vectorize_units.py counts a pixel as sprite above this alpha. */
export const SPRITE_ALPHA_CUT = 128;
export const MAX_STAMPS = 64;

export interface StampPlacement {
  emblem: EmblemId;
  /** One of the emblem's drawn sizes: its height before a turn. */
  size: number;
  /** The emblem's middle pixel, in sprite pixels. */
  x: number;
  y: number;
  flip: boolean;
  /** On its side: rows and columns swapped. */
  turn: boolean;
  /** Write only over pixels the sprite already has. */
  onlyOnSprite: boolean;
}

export interface StampSidecar {
  kind: "unit-stamps";
  version: 1;
  /** The polished PNG, relative to web/. */
  source: string;
  width: number;
  height: number;
  stamps: StampPlacement[];
}

/** Straight RGBA, four bytes a pixel, rows top to bottom. */
export interface SpritePixels {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

const POLISHED_PATH = /^assets\/candidates\/(GER|USSR|UK|US|JAP|MINOR)\/[A-Za-z0-9_-]+\.outlined\.polished\.png$/;
const STAMPED_PATH = /^assets\/candidates\/(GER|USSR|UK|US|JAP|MINOR)\/[A-Za-z0-9_-]+\.outlined\.stamped\.png$/;

export function isPolishedPng(path: string): boolean {
  return POLISHED_PATH.test(path);
}

function polishedOrThrow(path: string): string {
  const normal = path.replaceAll("\\", "/");
  if (!isPolishedPng(normal)) {
    throw new Error(`${path} is not a polished unit PNG under assets/candidates/<country>/.`);
  }
  return normal;
}

/** assets/candidates/US/us_bomber_seed1.outlined.polished.png -> assets/candidates/US/us_bomber_seed1.stamps.json */
export function stampsPathFor(polished: string): string {
  return polishedOrThrow(polished).slice(0, -POLISHED_PNG_SUFFIX.length) + STAMPS_SUFFIX;
}

export function stampedPngPathFor(polished: string): string {
  return polishedOrThrow(polished).slice(0, -POLISHED_PNG_SUFFIX.length) + STAMPED_PNG_SUFFIX;
}

/** The polished PNG behind a polished or stamped PNG path. Null for anything else. */
export function polishedPngFor(path: string): string | null {
  const normal = path.replaceAll("\\", "/");
  if (isPolishedPng(normal)) {
    return normal;
  }
  if (STAMPED_PATH.test(normal)) {
    return normal.slice(0, -STAMPED_PNG_SUFFIX.length) + POLISHED_PNG_SUFFIX;
  }
  return null;
}

/** The fixed colour of each emblem slot. All six are in the sixteen-colour palette the vectorizer snaps to. */
export const EMBLEM_HEX: Readonly<Record<EmblemSlotKey, string>> = Object.fromEntries(
  (Object.entries(EMBLEM_STRIP) as [EmblemSlotKey, keyof typeof MILITARY][]).map(([slot, key]) => [slot, MILITARY[key]]),
) as Record<EmblemSlotKey, string>;

function rgbOf(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const EMBLEM_RGB = Object.fromEntries(Object.entries(EMBLEM_HEX).map(([slot, hex]) => [slot, rgbOf(hex)])) as Record<EmblemSlotKey, [number, number, number]>;

export function emptySidecar(source: string, width: number, height: number): StampSidecar {
  return { kind: "unit-stamps", version: 1, source: polishedOrThrow(source), width, height, stamps: [] };
}

function wholeNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

function flag(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be true or false.`);
  }
  return value;
}

/** Checks a stamps file and fills in the defaults: no flip, no turn, only on the sprite. Throws a plain message. */
export function readStampSidecar(value: unknown): StampSidecar {
  if (typeof value !== "object" || value === null) {
    throw new Error("The stamps file is not an object.");
  }
  const file = value as Record<string, unknown>;
  if (file.kind !== "unit-stamps" || file.version !== 1) {
    throw new Error('The stamps file must say kind "unit-stamps" and version 1.');
  }
  const source = polishedOrThrow(typeof file.source === "string" ? file.source : "");
  const width = wholeNumber(file.width, "width", 1, 4096);
  const height = wholeNumber(file.height, "height", 1, 4096);
  if (!Array.isArray(file.stamps) || file.stamps.length > MAX_STAMPS) {
    throw new Error(`stamps must be a list of at most ${MAX_STAMPS}.`);
  }
  const stamps = file.stamps.map((item, index): StampPlacement => {
    const label = `Stamp ${index + 1}`;
    if (typeof item !== "object" || item === null) {
      throw new Error(`${label} is not an object.`);
    }
    const row = item as Record<string, unknown>;
    const emblem = typeof row.emblem === "string" ? emblemById(row.emblem) : null;
    if (!emblem) {
      throw new Error(`${label}: "${String(row.emblem)}" is not an emblem.`);
    }
    const size = wholeNumber(row.size, `${label} size`, 1, 512);
    if (!emblem.sizes.some((drawn) => drawn.size === size)) {
      throw new Error(`${label}: ${emblem.name} is not drawn at ${size} pixels.`);
    }
    return {
      emblem: emblem.id,
      size,
      x: wholeNumber(row.x, `${label} x`, 0, width - 1),
      y: wholeNumber(row.y, `${label} y`, 0, height - 1),
      flip: flag(row.flip, `${label} flip`, false),
      turn: flag(row.turn, `${label} turn`, false),
      onlyOnSprite: flag(row.onlyOnSprite, `${label} onlyOnSprite`, true),
    };
  });
  return { kind: "unit-stamps", version: 1, source, width, height, stamps };
}

export function placementBitmap(placement: Pick<StampPlacement, "emblem" | "size" | "flip" | "turn">): EmblemBitmap {
  const emblem = emblemById(placement.emblem);
  if (!emblem) {
    throw new Error(`"${placement.emblem}" is not an emblem.`);
  }
  return emblemBitmap(emblem, placement.size, placement.flip, placement.turn);
}

/** Whether a pixel of the sprite is drawn. */
export function spriteSilhouette(sprite: SpritePixels): (x: number, y: number) => boolean {
  return (x, y) => x >= 0 && y >= 0 && x < sprite.width && y < sprite.height && (sprite.data[(y * sprite.width + x) * 4 + 3] ?? 0) > SPRITE_ALPHA_CUT;
}

export function opaquePixelCount(sprite: SpritePixels): number {
  let count = 0;
  for (let index = 3; index < sprite.width * sprite.height * 4; index += 4) {
    if ((sprite.data[index] ?? 0) > SPRITE_ALPHA_CUT) {
      count += 1;
    }
  }
  return count;
}

/** The cells one placement writes. `onSprite` is the silhouette of the sprite before any stamp. */
export function placementCells(
  sprite: Pick<SpritePixels, "width" | "height">,
  placement: StampPlacement,
  onSprite: (x: number, y: number) => boolean,
): StampCell[] {
  return emblemCells(placementBitmap(placement), placement, sprite, placement.onlyOnSprite ? { onlyOn: onSprite } : {});
}

/**
 * The sprite with every stamp written in order, as a new buffer. Emblem pixels take the emblem's fixed colour
 * at full alpha, so the result has no colour the polished PNG and the palette do not have. Only on the sprite
 * reads the sprite as it was before any stamp.
 */
export function compositeStamps(sprite: SpritePixels, stamps: readonly StampPlacement[]): { data: Uint8ClampedArray; written: number[] } {
  if (sprite.data.length !== sprite.width * sprite.height * 4) {
    throw new Error(`The picture data does not match ${sprite.width} by ${sprite.height}.`);
  }
  const data = Uint8ClampedArray.from(sprite.data);
  const onSprite = spriteSilhouette(sprite);
  const written = stamps.map((placement) => {
    const cells = placementCells(sprite, placement, onSprite);
    for (const { x, y, slot } of cells) {
      const [r, g, b] = EMBLEM_RGB[slot];
      const offset = (y * sprite.width + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = 255;
    }
    return cells.length;
  });
  return { data, written };
}

/** Of the drawn sizes, the one closest to `target`; the smaller on a tie. */
function nearestSize(emblem: Emblem, target: number): number {
  let best = emblem.sizes[0]?.size ?? 0;
  for (const drawn of emblem.sizes) {
    if (Math.abs(drawn.size - target) < Math.abs(best - target)) {
      best = drawn.size;
    }
  }
  return best;
}

/**
 * A starting size for a sprite: 0.18 of the square root of its drawn pixels, the nearest drawn size to that,
 * and never wider or taller than the sprite. A fighter gets 17, a T-34 17, a four-engine bomber 41.
 * Without a pixel count, half the canvas is taken as drawn.
 */
export function suggestEmblemSize(emblem: Emblem, sprite: { width: number; height: number; opaque?: number }): number {
  const drawn = sprite.opaque ?? (sprite.width * sprite.height) / 2;
  const fits = emblem.sizes.filter((item) => item.width <= sprite.width && item.height <= sprite.height);
  const pool = fits.length > 0 ? { ...emblem, sizes: fits } : { ...emblem, sizes: emblem.sizes.slice(0, 1) };
  return nearestSize(pool, 0.18 * Math.sqrt(Math.max(0, drawn)));
}
