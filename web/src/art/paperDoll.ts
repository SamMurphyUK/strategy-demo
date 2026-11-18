import { MILITARY } from "../ui/theme/militaryPalette";

export const PART_CATEGORIES = ["legs", "torso", "head", "weapon"] as const;
export type PartCategory = (typeof PART_CATEGORIES)[number];
export type AnimationState = "walk" | "idle" | "fire";

export interface PixelPoint {
  x: number;
  y: number;
}

/** Row-major semantic indices. 0 is transparent. Slots 1–13 are the palette. */
export interface IndexedImage {
  width: number;
  height: number;
  indices: number[];
}

export interface ModularPart {
  id: string;
  name: string;
  category: PartCategory;
  spriteData: IndexedImage;
  frames: IndexedImage[];
  width: number;
  height: number;
  anchor: PixelPoint;
  /** Per-frame anchor for a walk cycle. Rigid parts use `anchor` alone. */
  frameAnchors?: PixelPoint[];
  muzzleAnchor?: PixelPoint;
  frameCount: number;
}

export interface FrameSocketTransform {
  torsoOffset: PixelPoint;
  headSocket: PixelPoint;
  weaponSocket: PixelPoint;
  /** Where the torso hip and the top of the legs meet. */
  hipSocket: PixelPoint;
  weaponRecoilOffset?: PixelPoint;
  showMuzzleFlash?: boolean;
}

export interface RigManifest {
  id: string;
  frameWidth: number;
  frameHeight: number;
  animations: Record<AnimationState, FrameSocketTransform[]>;
}

export const MASK_RGB: Record<PartCategory, [number, number, number]> = {
  head: [255, 0, 0],
  torso: [0, 255, 0],
  weapon: [0, 0, 255],
  legs: [255, 255, 0],
};

/**
 * Quantize targets. Faction LUTs repaint these indices.
 * 12 and 13 stay the gun on every preset. 11 is the helmet.
 */
export const SEMANTIC_MASTER: readonly (string | null)[] = [
  null,
  MILITARY.cream,
  MILITARY.feldgrau,
  MILITARY.charcoal,
  MILITARY.taupe,
  MILITARY.spruce,
  MILITARY.brown,
  MILITARY.khaki,
  MILITARY.bone,
  MILITARY.tan,
  MILITARY.terracotta,
  MILITARY.feldgrau,
  MILITARY.steel,
  MILITARY.charcoal,
];

export const SLOT_LABELS = [
  "Transparent",
  "Uniform highlight",
  "Uniform mid",
  "Uniform shadow",
  "Webbing",
  "Gear",
  "Boots / leather",
  "Wood stock",
  "Skin highlight",
  "Skin mid",
  "Skin shadow",
  "Helmet",
  "Gun metal",
  "Gun shadow",
] as const;

export type FactionPresetId = "GER" | "UK" | "USSR" | "US" | "JAP";

const GUN_METAL = MILITARY.steel;
const GUN_SHADOW = MILITARY.charcoal;
const SKIN = [MILITARY.bone, MILITARY.tan, MILITARY.terracotta] as const;
const BOOTS = MILITARY.brown;
const WOOD = MILITARY.khaki;
const WEBBING = MILITARY.taupe;
const GEAR = MILITARY.plum;

function uniform(highlight: string, mid: string, shadow: string, helmet: string): string[] {
  return [
    "#00000000",
    highlight,
    mid,
    shadow,
    WEBBING,
    GEAR,
    BOOTS,
    WOOD,
    SKIN[0],
    SKIN[1],
    SKIN[2],
    helmet,
    GUN_METAL,
    GUN_SHADOW,
  ];
}

export const FACTION_PRESET_LABEL: Record<FactionPresetId, string> = {
  GER: "GER Feldgrau",
  UK: "UK Khaki",
  USSR: "USSR Olive",
  US: "US Mustard",
  JAP: "JAP Tan",
};

export const FACTION_LUTS: Record<FactionPresetId, readonly string[]> = {
  GER: uniform(MILITARY.bone, MILITARY.feldgrau, MILITARY.charcoal, MILITARY.feldgrau),
  UK: uniform(MILITARY.cream, MILITARY.khaki, MILITARY.taupe, MILITARY.khaki),
  USSR: uniform(MILITARY.sage, MILITARY.olive, MILITARY.spruce, MILITARY.olive),
  US: uniform(MILITARY.cream, MILITARY.brass, MILITARY.khaki, MILITARY.brass),
  JAP: uniform(MILITARY.cream, MILITARY.tan, MILITARY.terracotta, MILITARY.tan),
};

export function snap(value: number): number {
  return Math.round(value);
}

export function nearestSemanticSlot(r: number, g: number, b: number): number {
  let best = 1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let slot = 1; slot < SEMANTIC_MASTER.length; slot += 1) {
    const hex = SEMANTIC_MASTER[slot];
    if (!hex) {
      continue;
    }
    const rgb = Number.parseInt(hex.slice(1), 16);
    const dr = r - ((rgb >> 16) & 255);
    const dg = g - ((rgb >> 8) & 255);
    const db = b - (rgb & 255);
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = slot;
    }
  }
  return best;
}

/** Head metal becomes the helmet slot. Weapon metal stays on the gun slots. */
export function quantizePixel(r: number, g: number, b: number, alpha: number, category: PartCategory): number {
  if (alpha < 128) {
    return 0;
  }
  const slot = nearestSemanticSlot(r, g, b);
  if (category === "head" && slot >= 11) {
    return 11;
  }
  if (category === "weapon" && (slot === 11 || slot <= 5)) {
    return 12;
  }
  return slot;
}

export function categoryFromRgb(r: number, g: number, b: number): PartCategory | null {
  for (const category of PART_CATEGORIES) {
    const [red, green, blue] = MASK_RGB[category];
    if (r === red && g === green && b === blue) {
      return category;
    }
  }
  return null;
}

export function maskFromRgba(rgba: Uint8ClampedArray, width: number, height: number): (PartCategory | null)[] {
  const mask = new Array<PartCategory | null>(width * height).fill(null);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    if ((rgba[offset + 3] ?? 0) < 128) {
      continue;
    }
    mask[index] = categoryFromRgb(rgba[offset] ?? 0, rgba[offset + 1] ?? 0, rgba[offset + 2] ?? 0);
  }
  return mask;
}

export function quantizeImage(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  category: PartCategory,
): IndexedImage {
  const indices = new Array<number>(width * height).fill(0);
  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    indices[i] = quantizePixel(rgba[offset] ?? 0, rgba[offset + 1] ?? 0, rgba[offset + 2] ?? 0, rgba[offset + 3] ?? 0, category);
  }
  return { width, height, indices };
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boundsOf(points: readonly PixelPoint[]): Bounds | null {
  if (points.length === 0) {
    return null;
  }
  let minX = points[0]?.x ?? 0;
  let minY = points[0]?.y ?? 0;
  let maxX = minX;
  let maxY = minY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

/** Centre of the row where two parts meet, ignoring a one-pixel spur. */
function edgePoint(points: readonly PixelPoint[], edge: "top" | "bottom"): PixelPoint {
  const extreme = edge === "bottom" ? Math.max(...points.map((point) => point.y)) : Math.min(...points.map((point) => point.y));
  let band = points.filter((point) => point.y === extreme);
  if (band.length < 4) {
    const beside = edge === "bottom" ? extreme - 1 : extreme + 1;
    const thicker = points.filter((point) => point.y === beside);
    if (thicker.length > band.length) {
      band = thicker;
    }
  }
  return { x: snap(median(band.map((point) => point.x))), y: extreme };
}

const HAND_RGB = [0xb8, 0x7a, 0x60] as const;

/** The rifle pin sits in the largest hand, not the average of the barrel and the hip. */
function handGrip(
  points: readonly PixelPoint[],
  rgba: Uint8ClampedArray,
  sheetWidth: number,
  origin: number,
): PixelPoint | null {
  const skin = new Set<string>();
  for (const point of points) {
    const pixel = (point.y * sheetWidth + origin + point.x) * 4;
    if (
      (rgba[pixel] ?? 0) === HAND_RGB[0]
      && (rgba[pixel + 1] ?? 0) === HAND_RGB[1]
      && (rgba[pixel + 2] ?? 0) === HAND_RGB[2]
    ) {
      skin.add(`${point.x},${point.y}`);
    }
  }
  let best: PixelPoint[] = [];
  const seen = new Set<string>();
  for (const id of skin) {
    if (seen.has(id)) {
      continue;
    }
    const [startX, startY] = id.split(",").map(Number);
    const blob: PixelPoint[] = [];
    const queue = [{ x: startX ?? 0, y: startY ?? 0 }];
    seen.add(id);
    while (queue.length > 0) {
      const point = queue.pop();
      if (!point) {
        break;
      }
      blob.push(point);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const next = `${point.x + dx},${point.y + dy}`;
        if (!skin.has(next) || seen.has(next)) {
          continue;
        }
        seen.add(next);
        queue.push({ x: point.x + dx, y: point.y + dy });
      }
    }
    if (blob.length > best.length) {
      best = blob;
    }
  }
  if (best.length < 10) {
    return null;
  }
  return {
    x: snap(best.reduce((sum, point) => sum + point.x, 0) / best.length),
    y: snap(best.reduce((sum, point) => sum + point.y, 0) / best.length),
  };
}

function anchorFor(category: PartCategory, box: Bounds, points: readonly PixelPoint[]): PixelPoint {
  const midX = snap((box.minX + box.maxX) / 2) - box.minX;
  if (category === "legs") {
    return { x: midX, y: 0 };
  }
  if (category === "head" || category === "torso") {
    return { x: midX, y: box.maxY - box.minY };
  }
  let sx = 0;
  let sy = 0;
  for (const point of points) {
    sx += point.x;
    sy += point.y;
  }
  return { x: snap(sx / points.length) - box.minX, y: snap(sy / points.length) - box.minY };
}

function muzzleOf(box: Bounds, points: readonly PixelPoint[]): PixelPoint {
  let best = points[0] ?? { x: box.minX, y: box.minY };
  for (const point of points) {
    if (point.x > best.x || (point.x === best.x && point.y < best.y)) {
      best = point;
    }
  }
  return { x: best.x - box.minX, y: best.y - box.minY };
}

function editedSlot(
  rgba: Uint8ClampedArray,
  sheetWidth: number,
  frameOriginX: number,
  x: number,
  y: number,
  category: PartCategory,
  edit: { overrides: readonly number[]; retint: boolean },
): number {
  const sheetIndex = y * sheetWidth + frameOriginX + x;
  const override = edit.overrides[sheetIndex] ?? 0;
  if (override > 0) {
    return override;
  }
  const source = sheetIndex * 4;
  if ((rgba[source + 3] ?? 0) < 128) {
    if (category === "head") {
      return 11;
    }
    if (category === "torso") {
      return 2;
    }
    if (category === "legs") {
      return 6;
    }
    return 12;
  }
  const slot = quantizePixel(rgba[source] ?? 0, rgba[source + 1] ?? 0, rgba[source + 2] ?? 0, rgba[source + 3] ?? 0, category);
  return edit.retint ? retintWalkSlot(slot, category) : slot;
}

function cropIndexed(
  rgba: Uint8ClampedArray,
  sheetWidth: number,
  frameOriginX: number,
  box: Bounds,
  points: ReadonlySet<string>,
  category: PartCategory,
  edit?: { overrides: readonly number[]; retint: boolean },
): IndexedImage {
  const width = box.maxX - box.minX + 1;
  const height = box.maxY - box.minY + 1;
  const indices = new Array<number>(width * height).fill(0);
  for (let y = box.minY; y <= box.maxY; y += 1) {
    for (let x = box.minX; x <= box.maxX; x += 1) {
      if (!points.has(`${x},${y}`)) {
        continue;
      }
      const local = (y - box.minY) * width + (x - box.minX);
      if (edit) {
        indices[local] = editedSlot(rgba, sheetWidth, frameOriginX, x, y, category, edit);
      } else {
        const source = (y * sheetWidth + frameOriginX + x) * 4;
        indices[local] = quantizePixel(rgba[source] ?? 0, rgba[source + 1] ?? 0, rgba[source + 2] ?? 0, rgba[source + 3] ?? 0, category);
      }
    }
  }
  return { width, height, indices };
}

interface FrameParts {
  points: Record<PartCategory, PixelPoint[]>;
  box: Record<PartCategory, Bounds>;
  anchor: Record<PartCategory, PixelPoint>;
  image: Record<PartCategory, IndexedImage>;
  socket: FrameSocketTransform;
}

function readFrame(
  rgba: Uint8ClampedArray,
  mask: readonly (PartCategory | null)[],
  frameWidth: number,
  frameHeight: number,
  frameIndex: number,
): FrameParts | null {
  const origin = frameIndex * frameWidth;
  const points: Record<PartCategory, PixelPoint[]> = { legs: [], torso: [], head: [], weapon: [] };
  for (let y = 0; y < frameHeight; y += 1) {
    for (let x = 0; x < frameWidth; x += 1) {
      const sheetWidth = frameWidth * 8;
      const categoryAt = mask[y * sheetWidth + origin + x];
      if (!categoryAt) {
        continue;
      }
      const pixel = (y * sheetWidth + origin + x) * 4;
      if ((rgba[pixel + 3] ?? 0) < 128) {
        continue;
      }
      points[categoryAt].push({ x, y });
    }
  }
  if (points.head.length === 0 || points.torso.length === 0 || points.weapon.length === 0 || points.legs.length === 0) {
    return null;
  }
  const box = {} as Record<PartCategory, Bounds>;
  const anchor = {} as Record<PartCategory, PixelPoint>;
  const image = {} as Record<PartCategory, IndexedImage>;
  for (const category of PART_CATEGORIES) {
    const found = boundsOf(points[category]);
    if (!found) {
      return null;
    }
    box[category] = found;
    anchor[category] = anchorFor(category, found, points[category]);
    image[category] = cropIndexed(
      rgba,
      frameWidth * 8,
      origin,
      found,
      new Set(points[category].map((point) => `${point.x},${point.y}`)),
      category,
    );
  }
  const chin = edgePoint(points.head, "bottom");
  const hem = edgePoint(points.torso, "bottom");
  const thigh = edgePoint(points.legs, "top");
  anchor.head = { x: chin.x - box.head.minX, y: box.head.maxY - box.head.minY };
  anchor.torso = { x: hem.x - box.torso.minX, y: box.torso.maxY - box.torso.minY };
  anchor.legs = { x: thigh.x - box.legs.minX, y: 0 };
  const grip = handGrip(points.weapon, rgba, frameWidth * 8, origin);
  if (grip) {
    anchor.weapon = { x: grip.x - box.weapon.minX, y: grip.y - box.weapon.minY };
  }
  const hip = {
    x: box.torso.minX + anchor.torso.x,
    y: box.torso.minY + anchor.torso.y,
  };
  const socket: FrameSocketTransform = {
    torsoOffset: { x: 0, y: 0 },
    headSocket: { x: box.head.minX + anchor.head.x, y: box.head.minY + anchor.head.y },
    weaponSocket: { x: box.weapon.minX + anchor.weapon.x, y: box.weapon.minY + anchor.weapon.y },
    hipSocket: hip,
  };
  return { points, box, anchor, image, socket };
}

function withOffset(base: FrameSocketTransform, hip0: PixelPoint): FrameSocketTransform {
  return {
    ...base,
    torsoOffset: { x: base.hipSocket.x - hip0.x, y: base.hipSocket.y - hip0.y },
  };
}

export function deriveIdleAndFire(standing: FrameSocketTransform): Pick<RigManifest["animations"], "idle" | "fire"> {
  const rest: FrameSocketTransform = {
    torsoOffset: { x: 0, y: 0 },
    headSocket: { ...standing.headSocket },
    weaponSocket: { ...standing.weaponSocket },
    hipSocket: { ...standing.hipSocket },
  };
  const breath: FrameSocketTransform = {
    torsoOffset: { x: 0, y: -1 },
    headSocket: { x: standing.headSocket.x, y: standing.headSocket.y - 1 },
    weaponSocket: { ...standing.weaponSocket },
    hipSocket: { x: standing.hipSocket.x, y: standing.hipSocket.y - 1 },
  };
  const aim: FrameSocketTransform = { ...rest };
  const kick: FrameSocketTransform = {
    ...rest,
    weaponRecoilOffset: { x: -2, y: 0 },
    showMuzzleFlash: true,
  };
  return { idle: [rest, breath], fire: [aim, kick, { ...rest }] };
}

export function rebuildIdleAndFire(manifest: RigManifest): RigManifest {
  const standing = manifest.animations.walk[0];
  if (!standing) {
    throw new Error("Walk frame 0 is missing.");
  }
  return { ...manifest, animations: { ...manifest.animations, ...deriveIdleAndFire(standing) } };
}

export interface ExtractedRig {
  manifest: RigManifest;
  parts: ModularPart[];
}

export function extractRig(
  rgba: Uint8ClampedArray,
  mask: readonly (PartCategory | null)[],
  sheetWidth: number,
  sheetHeight: number,
  id = "soldier_rig",
): ExtractedRig {
  if (sheetWidth % 8 !== 0) {
    throw new Error("The reference sheet needs eight equal frames across.");
  }
  const frameWidth = sheetWidth / 8;
  const frameHeight = sheetHeight;
  if (mask.length !== sheetWidth * sheetHeight) {
    throw new Error("The mask does not cover the reference sheet.");
  }
  const frames: (FrameParts | null)[] = [];
  for (let index = 0; index < 8; index += 1) {
    frames.push(readFrame(rgba, mask, frameWidth, frameHeight, index));
  }
  const first = frames[0];
  if (!first) {
    throw new Error("Frame 0 needs a head, torso, weapon, and legs mask.");
  }
  const hip0 = first.socket.hipSocket;
  const head0 = first.socket.headSocket;
  const weapon0 = first.socket.weaponSocket;
  const walk = frames.map((frame) => {
    const socket = frame?.socket ?? first.socket;
    const dx = socket.headSocket.x - head0.x;
    const dy = socket.headSocket.y - head0.y;
    return withOffset(
      {
        ...socket,
        hipSocket: { x: hip0.x + dx, y: hip0.y + dy },
        weaponSocket: { x: weapon0.x + dx, y: weapon0.y + dy },
      },
      hip0,
    );
  });
  const standing = walk[0];
  if (!standing) {
    throw new Error("Frame 0 needs a head, torso, weapon, and legs mask.");
  }
  const derived = deriveIdleAndFire(standing);
  const legFrames = frames.map((frame) => frame?.image.legs ?? first.image.legs);
  const muzzle = muzzleOf(first.box.weapon, first.points.weapon);
  const parts: ModularPart[] = [
    partFrom("head_base", "Head", "head", [first.image.head], first.anchor.head),
    partFrom("torso_base", "Torso", "torso", [first.image.torso], first.anchor.torso),
    partFrom("weapon_base", "Weapon", "weapon", [first.image.weapon], first.anchor.weapon, muzzle),
    partFrom(
      "legs_base",
      "Legs",
      "legs",
      legFrames,
      first.anchor.legs,
      undefined,
      frames.map((frame) => frame?.anchor.legs ?? first.anchor.legs),
    ),
  ];
  return {
    manifest: { id, frameWidth, frameHeight, animations: { walk, ...derived } },
    parts,
  };
}

function partFrom(
  id: string,
  name: string,
  category: PartCategory,
  frames: IndexedImage[],
  anchor: PixelPoint,
  muzzleAnchor?: PixelPoint,
  frameAnchors?: PixelPoint[],
): ModularPart {
  const sprite = frames[0];
  if (!sprite) {
    throw new Error(`The ${category} part is empty.`);
  }
  return {
    id,
    name,
    category,
    spriteData: sprite,
    frames,
    width: sprite.width,
    height: sprite.height,
    anchor,
    frameAnchors,
    muzzleAnchor,
    frameCount: frames.length,
  };
}

export function nudgeSocket(
  manifest: RigManifest,
  animation: AnimationState,
  frameIndex: number,
  pin: "head" | "weapon" | "torso",
  dx: number,
  dy: number,
): RigManifest {
  const track = manifest.animations[animation].map((frame, index) => {
    if (index !== frameIndex) {
      return frame;
    }
    const next = { ...frame };
    if (pin === "head") {
      next.headSocket = { x: snap(frame.headSocket.x + dx), y: snap(frame.headSocket.y + dy) };
    } else if (pin === "weapon") {
      next.weaponSocket = { x: snap(frame.weaponSocket.x + dx), y: snap(frame.weaponSocket.y + dy) };
    } else {
      next.torsoOffset = { x: snap(frame.torsoOffset.x + dx), y: snap(frame.torsoOffset.y + dy) };
      next.hipSocket = { x: snap(frame.hipSocket.x + dx), y: snap(frame.hipSocket.y + dy) };
    }
    return next;
  });
  const animations = { ...manifest.animations, [animation]: track };
  if (animation === "walk" && frameIndex === 0 && track[0]) {
    return { ...manifest, animations: { ...animations, ...deriveIdleAndFire(track[0]) } };
  }
  return { ...manifest, animations };
}

export function placeSocket(
  manifest: RigManifest,
  animation: AnimationState,
  frameIndex: number,
  pin: "head" | "weapon" | "torso",
  at: PixelPoint,
): RigManifest {
  const frame = manifest.animations[animation][frameIndex];
  if (!frame) {
    return manifest;
  }
  const point = { x: snap(at.x), y: snap(at.y) };
  if (pin === "head") {
    return nudgeSocket(manifest, animation, frameIndex, pin, point.x - frame.headSocket.x, point.y - frame.headSocket.y);
  }
  if (pin === "weapon") {
    return nudgeSocket(manifest, animation, frameIndex, pin, point.x - frame.weaponSocket.x, point.y - frame.weaponSocket.y);
  }
  return nudgeSocket(manifest, animation, frameIndex, pin, point.x - frame.hipSocket.x, point.y - frame.hipSocket.y);
}

export function importQuantizedPart(
  id: string,
  name: string,
  category: PartCategory,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): ModularPart {
  const framesAcross = category === "legs" && width % 8 === 0 && width / height >= 2 ? 8 : 1;
  const frameWidth = width / framesAcross;
  const images: IndexedImage[] = [];
  const anchors: PixelPoint[] = [];
  let muzzle: PixelPoint | undefined;
  for (let frame = 0; frame < framesAcross; frame += 1) {
    const points: PixelPoint[] = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < frameWidth; x += 1) {
        const offset = (y * width + frame * frameWidth + x) * 4;
        if ((rgba[offset + 3] ?? 0) < 128) {
          continue;
        }
        points.push({ x, y });
      }
    }
    if (points.length === 0) {
      throw new Error(`The ${category} picture has an empty frame.`);
    }
    const box = boundsOf(points);
    if (!box) {
      throw new Error(`The ${category} picture is empty.`);
    }
    images.push(cropIndexed(rgba, width, frame * frameWidth, box, new Set(points.map((point) => `${point.x},${point.y}`)), category));
    anchors.push(anchorFor(category, box, points));
    if (category === "weapon" && frame === 0) {
      muzzle = muzzleOf(box, points);
    }
  }
  const sprite = images[0];
  const anchor = anchors[0];
  if (!sprite || !anchor) {
    throw new Error(`The ${category} picture is empty.`);
  }
  return {
    id,
    name,
    category,
    spriteData: sprite,
    frames: images,
    width: sprite.width,
    height: sprite.height,
    anchor,
    frameAnchors: framesAcross > 1 ? anchors : undefined,
    muzzleAnchor: muzzle,
    frameCount: images.length,
  };
}

function blitIndexed(dest: IndexedImage, sprite: IndexedImage, anchor: PixelPoint, target: PixelPoint): void {
  const originX = snap(target.x - anchor.x);
  const originY = snap(target.y - anchor.y);
  for (let y = 0; y < sprite.height; y += 1) {
    for (let x = 0; x < sprite.width; x += 1) {
      const slot = sprite.indices[y * sprite.width + x] ?? 0;
      if (slot === 0) {
        continue;
      }
      const destX = originX + x;
      const destY = originY + y;
      if (destX < 0 || destY < 0 || destX >= dest.width || destY >= dest.height) {
        continue;
      }
      dest.indices[destY * dest.width + destX] = slot;
    }
  }
}

export function composeFrame(
  manifest: RigManifest,
  parts: Record<PartCategory, ModularPart>,
  animation: AnimationState,
  frameIndex: number,
): IndexedImage {
  const socket = manifest.animations[animation][frameIndex];
  if (!socket) {
    throw new Error(`Missing ${animation} frame ${frameIndex}.`);
  }
  const indices = new Array<number>(manifest.frameWidth * manifest.frameHeight).fill(0);
  const dest: IndexedImage = { width: manifest.frameWidth, height: manifest.frameHeight, indices };
  const legFrame = animation === "walk" ? frameIndex : 0;
  const legs = parts.legs.frames[legFrame] ?? parts.legs.spriteData;
  const legAnchor = parts.legs.frameAnchors?.[legFrame] ?? parts.legs.anchor;
  const recoil = socket.weaponRecoilOffset ?? { x: 0, y: 0 };
  blitIndexed(dest, legs, legAnchor, socket.hipSocket);
  blitIndexed(dest, parts.torso.spriteData, parts.torso.anchor, socket.hipSocket);
  blitIndexed(dest, parts.head.spriteData, parts.head.anchor, socket.headSocket);
  blitIndexed(dest, parts.weapon.spriteData, parts.weapon.anchor, {
    x: socket.weaponSocket.x + recoil.x,
    y: socket.weaponSocket.y + recoil.y,
  });
  return dest;
}

function writeHex(data: Uint8ClampedArray, offset: number, hex: string, alpha = 255): void {
  const rgb = Number.parseInt(hex.slice(1), 16);
  data[offset] = (rgb >> 16) & 255;
  data[offset + 1] = (rgb >> 8) & 255;
  data[offset + 2] = rgb & 255;
  data[offset + 3] = alpha;
}

export function paintIndexed(image: IndexedImage, lut: readonly string[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(image.width * image.height * 4);
  for (let i = 0; i < image.indices.length; i += 1) {
    const slot = image.indices[i] ?? 0;
    if (slot === 0) {
      continue;
    }
    const hex = lut[slot];
    if (hex) {
      writeHex(data, i * 4, hex);
    }
  }
  return data;
}

function stampFlash(data: Uint8ClampedArray, width: number, height: number, at: PixelPoint): void {
  const pixels = [
    [0, 0, MILITARY.cream],
    [1, 0, MILITARY.cream],
    [2, 0, MILITARY.brass],
    [0, 1, MILITARY.brass],
    [1, 1, MILITARY.cream],
  ] as const;
  for (const [dx, dy, hex] of pixels) {
    const x = snap(at.x + dx);
    const y = snap(at.y + dy);
    if (x < 0 || y < 0 || x >= width || y >= height) {
      continue;
    }
    writeHex(data, (y * width + x) * 4, hex);
  }
}

export interface BakedSheet {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  meta: {
    manifest: RigManifest;
    assembly: Record<PartCategory, string>;
    faction: string;
    rows: { walk: number; idle: number; fire: number };
    frames: Record<AnimationState, number>;
  };
}

export function bakeSpritesheet(
  manifest: RigManifest,
  parts: Record<PartCategory, ModularPart>,
  lut: readonly string[],
  faction: string,
): BakedSheet {
  const width = manifest.frameWidth * 8;
  const height = manifest.frameHeight * 3;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const rows: Record<AnimationState, number> = { walk: 0, idle: 1, fire: 2 };
  (Object.keys(rows) as AnimationState[]).forEach((animation) => {
    manifest.animations[animation].forEach((socket, frameIndex) => {
      const composed = composeFrame(manifest, parts, animation, frameIndex);
      const painted = paintIndexed(composed, lut);
      const originX = frameIndex * manifest.frameWidth;
      const originY = rows[animation] * manifest.frameHeight;
      for (let y = 0; y < composed.height; y += 1) {
        for (let x = 0; x < composed.width; x += 1) {
          const source = (y * composed.width + x) * 4;
          if ((painted[source + 3] ?? 0) === 0) {
            continue;
          }
          const dest = ((originY + y) * width + originX + x) * 4;
          rgba[dest] = painted[source] ?? 0;
          rgba[dest + 1] = painted[source + 1] ?? 0;
          rgba[dest + 2] = painted[source + 2] ?? 0;
          rgba[dest + 3] = painted[source + 3] ?? 0;
        }
      }
      if (socket.showMuzzleFlash && parts.weapon.muzzleAnchor) {
        const recoil = socket.weaponRecoilOffset ?? { x: 0, y: 0 };
        const originWeaponX = socket.weaponSocket.x + recoil.x - parts.weapon.anchor.x;
        const originWeaponY = socket.weaponSocket.y + recoil.y - parts.weapon.anchor.y;
        stampFlash(rgba, width, height, {
          x: originX + originWeaponX + parts.weapon.muzzleAnchor.x,
          y: originY + originWeaponY + parts.weapon.muzzleAnchor.y,
        });
      }
    });
  });
  return {
    width,
    height,
    rgba,
    meta: {
      manifest,
      assembly: {
        head: parts.head.id,
        torso: parts.torso.id,
        legs: parts.legs.id,
        weapon: parts.weapon.id,
      },
      faction,
      rows: { walk: 0, idle: 1, fire: 2 },
      frames: { walk: 8, idle: 2, fire: 3 },
    },
  };
}

export interface ReferenceSheet {
  rgba: Uint8ClampedArray;
  mask: (PartCategory | null)[];
  width: number;
  height: number;
}

function paintDot(
  rgba: Uint8ClampedArray,
  mask: (PartCategory | null)[],
  width: number,
  x: number,
  y: number,
  hex: string,
  category: PartCategory,
): void {
  const offset = (y * width + x) * 4;
  writeHex(rgba, offset, hex);
  mask[y * width + x] = category;
}

const WALK_FACE = "ddcf99";
const WALK_HELMET = "a9a25d";
const WALK_SKIN = "b87a60";
const WALK_BROWN = "846d59";
const WALK_KHAKI = "a78a5e";
const WALK_OUTLINE = "4b3d44";

interface ColourBlob {
  pts: PixelPoint[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  n: number;
}

function hexOf(rgba: Uint8ClampedArray, sheetWidth: number, x: number, y: number): string | null {
  const offset = (y * sheetWidth + x) * 4;
  if ((rgba[offset + 3] ?? 0) < 128) {
    return null;
  }
  const r = (rgba[offset] ?? 0).toString(16).padStart(2, "0");
  const g = (rgba[offset + 1] ?? 0).toString(16).padStart(2, "0");
  const b = (rgba[offset + 2] ?? 0).toString(16).padStart(2, "0");
  return `${r}${g}${b}`;
}

function colourBlobs(
  rgba: Uint8ClampedArray,
  sheetWidth: number,
  originX: number,
  originY: number,
  cell: number,
  match: (hex: string) => boolean,
): ColourBlob[] {
  const seen = new Set<string>();
  const blobs: ColourBlob[] = [];
  for (let y = 0; y < cell; y += 1) {
    for (let x = 0; x < cell; x += 1) {
      const hex = hexOf(rgba, sheetWidth, originX + x, originY + y);
      if (!hex || !match(hex)) {
        continue;
      }
      const id = `${x},${y}`;
      if (seen.has(id)) {
        continue;
      }
      const queue: PixelPoint[] = [{ x, y }];
      seen.add(id);
      const pts: PixelPoint[] = [];
      while (queue.length > 0) {
        const point = queue.pop();
        if (!point) {
          break;
        }
        pts.push(point);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = point.x + dx;
          const ny = point.y + dy;
          if (nx < 0 || ny < 0 || nx >= cell || ny >= cell) {
            continue;
          }
          const key = `${nx},${ny}`;
          if (seen.has(key)) {
            continue;
          }
          const next = hexOf(rgba, sheetWidth, originX + nx, originY + ny);
          if (!next || !match(next)) {
            continue;
          }
          seen.add(key);
          queue.push({ x: nx, y: ny });
        }
      }
      let minX = pts[0]?.x ?? 0;
      let minY = pts[0]?.y ?? 0;
      let maxX = minX;
      let maxY = minY;
      for (const point of pts) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
      blobs.push({ pts, minX, minY, maxX, maxY, n: pts.length });
    }
  }
  return blobs;
}

function paintBlob(label: (PartCategory | null)[], cell: number, blob: ColourBlob, category: PartCategory): void {
  for (const point of blob.pts) {
    const index = point.y * cell + point.x;
    if (!label[index]) {
      label[index] = category;
    }
  }
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Split one square cell the way frame 0 was painted.
 * The face, the helmet, the hands, and both cream parts of the rifle name the objects.
 * The hem is the row above the trousers. Positions follow each frame's own pixels.
 */
function segmentWalkCell(
  rgba: Uint8ClampedArray,
  sheetWidth: number,
  originX: number,
  originY: number,
  cell: number,
  frameIndex: number,
): (PartCategory | null)[] {
  const label = new Array<PartCategory | null>(cell * cell).fill(null);
  const colour = (x: number, y: number) => hexOf(rgba, sheetWidth, originX + x, originY + y);
  const creams = colourBlobs(rgba, sheetWidth, originX, originY, cell, (hex) => hex === WALK_FACE).filter((blob) => blob.n >= 3);
  const face = [...creams].sort((a, b) => b.n - a.n)[0];
  const mustards = colourBlobs(rgba, sheetWidth, originX, originY, cell, (hex) => hex === WALK_HELMET).filter((blob) => blob.n >= 3);
  const helmet = mustards.filter((blob) => blob.n > 80).sort((a, b) => a.minY - b.minY)[0];
  if (!face || !helmet) {
    throw new Error(`Frame ${frameIndex} has no helmet and face to pin.`);
  }
  const trousers = mustards.filter((blob) => blob.minY > face.maxY + 10 && blob.maxY - blob.minY >= 8);
  const waist = trousers.length > 0 ? Math.min(...trousers.map((blob) => blob.minY)) - 1 : face.maxY + 16;
  for (const blob of creams) {
    paintBlob(label, cell, blob, blob === face ? "head" : "weapon");
  }
  for (const blob of mustards) {
    if (blob === helmet) {
      paintBlob(label, cell, blob, "head");
      continue;
    }
    for (const point of blob.pts) {
      const index = point.y * cell + point.x;
      if (!label[index]) {
        label[index] = point.y >= waist ? "legs" : "torso";
      }
    }
  }
  for (const blob of colourBlobs(rgba, sheetWidth, originX, originY, cell, (hex) => hex === WALK_SKIN)) {
    paintBlob(label, cell, blob, blob.minY < waist ? "weapon" : "legs");
  }
  for (const blob of colourBlobs(rgba, sheetWidth, originX, originY, cell, (hex) => hex === WALK_BROWN)) {
    const brim = blob.n < 25 && blob.maxY <= face.minY + 3 && blob.maxX >= helmet.minX && blob.minX <= helmet.maxX;
    for (const point of blob.pts) {
      const index = point.y * cell + point.x;
      if (label[index]) {
        continue;
      }
      label[index] = brim ? "head" : point.y >= waist ? "legs" : "torso";
    }
  }
  for (const blob of colourBlobs(rgba, sheetWidth, originX, originY, cell, (hex) => hex === WALK_KHAKI)) {
    const brim = blob.maxY <= face.minY + 2 && blob.minX >= helmet.minX - 1 && blob.maxX <= helmet.maxX + 1;
    for (const point of blob.pts) {
      const index = point.y * cell + point.x;
      if (label[index]) {
        continue;
      }
      if (brim) {
        label[index] = "head";
      } else {
        label[index] = point.y >= waist ? "legs" : "torso";
      }
    }
  }
  const rifleTone = (hex: string | null) => hex === WALK_BROWN || hex === WALK_KHAKI || hex === "645355";
  for (let y = 0; y <= waist; y += 1) {
    for (let x = 0; x < cell; x += 1) {
      const index = y * cell + x;
      const hex = colour(x, y);
      if (!rifleTone(hex) || label[index] === "head" || label[index] === "weapon") {
        continue;
      }
      const touchesWeapon = NEIGHBOURS.some(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        return nx >= 0 && ny >= 0 && nx < cell && ny < cell && label[ny * cell + nx] === "weapon";
      });
      const touchesTorso = NEIGHBOURS.some(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        return nx >= 0 && ny >= 0 && nx < cell && ny < cell && label[ny * cell + nx] === "torso";
      });
      if (touchesWeapon && !touchesTorso) {
        label[index] = "weapon";
      }
    }
  }
  const headRight = Math.max(face.maxX, helmet.maxX) + 1;
  for (let pass = 0; pass < 3; pass += 1) {
    for (let y = 0; y <= face.maxY - 2; y += 1) {
      for (let x = helmet.minX - 1; x <= headRight; x += 1) {
        if (x < 0 || x >= cell || label[y * cell + x] || colour(x, y) !== WALK_OUTLINE) {
          continue;
        }
        const touchesHead = NEIGHBOURS.some(([dx, dy]) => {
          const nx = x + dx;
          const ny = y + dy;
          return nx >= 0 && ny >= 0 && nx < cell && ny < cell && label[ny * cell + nx] === "head";
        });
        if (touchesHead) {
          label[y * cell + x] = "head";
        }
      }
    }
  }
  for (let y = 0; y <= face.minY + 2; y += 1) {
    for (let x = helmet.minX - 1; x <= helmet.maxX + 1; x += 1) {
      if (x < 0 || x >= cell || y >= cell || label[y * cell + x]) {
        continue;
      }
      const hex = colour(x, y);
      if (hex === WALK_OUTLINE || hex === "645355") {
        label[y * cell + x] = "head";
      }
    }
  }
  const seeds: { x: number; y: number; category: PartCategory }[] = [];
  for (let y = 0; y < cell; y += 1) {
    for (let x = 0; x < cell; x += 1) {
      const category = label[y * cell + x];
      if (category) {
        seeds.push({ x, y, category });
      }
    }
  }
  for (let y = 0; y < cell; y += 1) {
    for (let x = 0; x < cell; x += 1) {
      if (!colour(x, y) || label[y * cell + x]) {
        continue;
      }
      let best: PartCategory = y >= waist ? "legs" : "torso";
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const seed of seeds) {
        if (seed.category === "head") {
          continue;
        }
        const distance = Math.abs(seed.x - x) + Math.abs(seed.y - y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = seed.category;
          if (distance <= 1) {
            break;
          }
        }
      }
      label[y * cell + x] = best;
    }
  }
  return label;
}

/**
 * The uniform mustard lands on the wood slot by nearest colour.
 * Helmet and cloth move onto the slots a faction preset actually recolours.
 */
export function retintWalkSlot(slot: number, category: PartCategory): number {
  if (slot === 0) {
    return 0;
  }
  if (category === "head") {
    if (slot === 7 || slot === 2) {
      return 11;
    }
    if (slot === 1) {
      return 8;
    }
    if (slot === 6) {
      return 3;
    }
    return slot;
  }
  if (category === "legs" && slot === 10) {
    return 6;
  }
  if ((category === "torso" || category === "legs") && slot === 7) {
    return 2;
  }
  if (category === "weapon" && (slot === 1 || slot === 7)) {
    return 7;
  }
  return slot;
}

function framePixelIndex(
  sheetWidth: number,
  frameWidth: number,
  frameHeight: number,
  frameIndex: number,
  pixel: PixelPoint,
): number | null {
  if (pixel.x < 0 || pixel.y < 0 || pixel.x >= frameWidth || pixel.y >= frameHeight) {
    return null;
  }
  return pixel.y * sheetWidth + frameIndex * frameWidth + pixel.x;
}

/** Paint or erase area membership. Slot 0 keeps the sheet colour. A positive slot forces that index. */
export function paintMaskPixels(
  mask: readonly (PartCategory | null)[],
  overrides: readonly number[],
  sheetWidth: number,
  frameIndex: number,
  frameWidth: number,
  frameHeight: number,
  pixels: readonly PixelPoint[],
  category: PartCategory | null,
  slot: number,
): { mask: (PartCategory | null)[]; overrides: number[] } {
  const nextMask = mask.slice();
  const nextOverrides = overrides.length === mask.length ? overrides.slice() : new Array<number>(mask.length).fill(0);
  const paintSlot = category === null || slot <= 0 ? 0 : Math.min(13, Math.round(slot));
  let changed = false;
  for (const pixel of pixels) {
    const index = framePixelIndex(sheetWidth, frameWidth, frameHeight, frameIndex, pixel);
    if (index === null || index >= nextMask.length) {
      continue;
    }
    if (nextMask[index] === category && (nextOverrides[index] ?? 0) === paintSlot) {
      continue;
    }
    nextMask[index] = category;
    nextOverrides[index] = paintSlot;
    changed = true;
  }
  if (!changed) {
    return {
      mask: mask as (PartCategory | null)[],
      overrides: overrides.length === mask.length ? (overrides as number[]) : nextOverrides,
    };
  }
  return { mask: nextMask, overrides: nextOverrides };
}

/** Click selects the connected patch that shares this pixel's area. An empty pixel selects only itself. */
export function floodMask(
  mask: readonly (PartCategory | null)[],
  rgba: Uint8ClampedArray,
  sheetWidth: number,
  frameWidth: number,
  frameHeight: number,
  frameIndex: number,
  origin: PixelPoint,
): PixelPoint[] {
  const start = framePixelIndex(sheetWidth, frameWidth, frameHeight, frameIndex, origin);
  if (start === null || start >= mask.length) {
    return [];
  }
  const label = mask[start] ?? null;
  if (label === null && (rgba[start * 4 + 3] ?? 0) < 128) {
    return [{ x: origin.x, y: origin.y }];
  }
  const seen = new Set<number>();
  const stack: PixelPoint[] = [{ x: origin.x, y: origin.y }];
  const out: PixelPoint[] = [];
  while (stack.length > 0) {
    const pixel = stack.pop();
    if (!pixel) {
      break;
    }
    const index = framePixelIndex(sheetWidth, frameWidth, frameHeight, frameIndex, pixel);
    if (index === null || seen.has(index)) {
      continue;
    }
    seen.add(index);
    if ((mask[index] ?? null) !== label) {
      continue;
    }
    if (label === null && (rgba[index * 4 + 3] ?? 0) < 128) {
      continue;
    }
    out.push({ x: pixel.x, y: pixel.y });
    stack.push(
      { x: pixel.x - 1, y: pixel.y },
      { x: pixel.x + 1, y: pixel.y },
      { x: pixel.x, y: pixel.y - 1 },
      { x: pixel.x, y: pixel.y + 1 },
    );
  }
  return out;
}

/** Opaque pixels, and pixels that already belong to an area, inside the box. */
export function maskPixelsInRect(
  mask: readonly (PartCategory | null)[],
  rgba: Uint8ClampedArray,
  sheetWidth: number,
  frameWidth: number,
  frameHeight: number,
  frameIndex: number,
  a: PixelPoint,
  b: PixelPoint,
): PixelPoint[] {
  const minX = Math.max(0, Math.min(a.x, b.x));
  const maxX = Math.min(frameWidth - 1, Math.max(a.x, b.x));
  const minY = Math.max(0, Math.min(a.y, b.y));
  const maxY = Math.min(frameHeight - 1, Math.max(a.y, b.y));
  const out: PixelPoint[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const index = y * sheetWidth + frameIndex * frameWidth + x;
      if (mask[index] || (rgba[index * 4 + 3] ?? 0) >= 128) {
        out.push({ x, y });
      }
    }
  }
  return out;
}

function pointsForCategory(
  mask: readonly (PartCategory | null)[],
  sheetWidth: number,
  frameWidth: number,
  frameHeight: number,
  frameIndex: number,
  category: PartCategory,
): PixelPoint[] {
  const origin = frameIndex * frameWidth;
  const points: PixelPoint[] = [];
  for (let y = 0; y < frameHeight; y += 1) {
    for (let x = 0; x < frameWidth; x += 1) {
      if (mask[y * sheetWidth + origin + x] === category) {
        points.push({ x, y });
      }
    }
  }
  return points;
}

function cropCategory(
  rgba: Uint8ClampedArray,
  mask: readonly (PartCategory | null)[],
  overrides: readonly number[],
  sheetWidth: number,
  frameWidth: number,
  frameHeight: number,
  frameIndex: number,
  category: PartCategory,
  retint: boolean,
): { image: IndexedImage; anchor: PixelPoint; muzzle?: PixelPoint } | null {
  const points = pointsForCategory(mask, sheetWidth, frameWidth, frameHeight, frameIndex, category);
  const box = boundsOf(points);
  if (!box) {
    return null;
  }
  return {
    image: cropIndexed(rgba, sheetWidth, frameIndex * frameWidth, box, new Set(points.map((point) => `${point.x},${point.y}`)), category, {
      overrides,
      retint,
    }),
    anchor: anchorFor(category, box, points),
    muzzle: category === "weapon" ? muzzleOf(box, points) : undefined,
  };
}

function emptyImage(): IndexedImage {
  return { width: 1, height: 1, indices: [0] };
}

const PART_NAME: Record<PartCategory, string> = {
  head: "Head",
  torso: "Torso",
  weapon: "Weapon",
  legs: "Legs",
};

function namedPart(
  previous: readonly ModularPart[],
  category: PartCategory,
  frames: IndexedImage[],
  anchor: PixelPoint,
  muzzleAnchor?: PixelPoint,
  frameAnchors?: PixelPoint[],
): ModularPart {
  const prior = previous.find((part) => part.category === category);
  return partFrom(prior?.id ?? `${category}_base`, prior?.name ?? PART_NAME[category], category, frames, anchor, muzzleAnchor, frameAnchors);
}

/**
 * Rebuild the four parts from a hand-painted mask.
 * Head, torso, and weapon come from frame 0. Each frame keeps its own legs.
 * Socket positions are left alone.
 */
export function rebuildPartsFromMask(
  rgba: Uint8ClampedArray,
  mask: readonly (PartCategory | null)[],
  overrides: readonly number[],
  sheetWidth: number,
  sheetHeight: number,
  previous: readonly ModularPart[],
  retint: boolean,
): ModularPart[] {
  if (sheetWidth % 8 !== 0) {
    throw new Error("The reference sheet needs eight equal frames across.");
  }
  const frameWidth = sheetWidth / 8;
  const frameHeight = sheetHeight;
  const padded = overrides.length === mask.length ? overrides : new Array<number>(mask.length).fill(0);
  const next: ModularPart[] = [];
  for (const category of ["head", "torso", "weapon"] as const) {
    const built = cropCategory(rgba, mask, padded, sheetWidth, frameWidth, frameHeight, 0, category, retint);
    if (!built) {
      next.push(namedPart(previous, category, [emptyImage()], { x: 0, y: 0 }));
      continue;
    }
    next.push(namedPart(previous, category, [built.image], built.anchor, built.muzzle));
  }
  const frames: IndexedImage[] = [];
  const anchors: PixelPoint[] = [];
  for (let frame = 0; frame < 8; frame += 1) {
    const built = cropCategory(rgba, mask, padded, sheetWidth, frameWidth, frameHeight, frame, "legs", retint);
    if (!built) {
      frames.push(emptyImage());
      anchors.push({ x: 0, y: 0 });
    } else {
      frames.push(built.image);
      anchors.push(built.anchor);
    }
  }
  next.push(namedPart(previous, "legs", frames, anchors[0] ?? { x: 0, y: 0 }, undefined, anchors));
  return next;
}

export function retintWalkParts(parts: readonly ModularPart[]): ModularPart[] {
  const paint = (image: IndexedImage, category: PartCategory): IndexedImage => ({
    width: image.width,
    height: image.height,
    indices: image.indices.map((slot) => retintWalkSlot(slot, category)),
  });
  return parts.map((part) => {
    const frames = part.frames.map((frame) => paint(frame, part.category));
    const sprite = frames[0] ?? paint(part.spriteData, part.category);
    return { ...part, spriteData: sprite, frames };
  });
}

/** Turn the 4×2 walk sheet into eight frames in a row, with a part mask on each. */
export function layoutWalkGrid(rgba: Uint8ClampedArray, width: number, height: number): ReferenceSheet {
  if (width % 4 !== 0 || height % 2 !== 0 || width / 4 !== height / 2) {
    throw new Error("The walk sheet needs four columns and two rows of square frames.");
  }
  const cell = width / 4;
  const outWidth = cell * 8;
  const out = new Uint8ClampedArray(outWidth * cell * 4);
  const mask = new Array<PartCategory | null>(outWidth * cell).fill(null);
  let frameIndex = 0;
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const originX = col * cell;
      const originY = row * cell;
      const labels = segmentWalkCell(rgba, width, originX, originY, cell, frameIndex);
      const frameOrigin = frameIndex * cell;
      for (let y = 0; y < cell; y += 1) {
        for (let x = 0; x < cell; x += 1) {
          const source = ((originY + y) * width + originX + x) * 4;
          const dest = (y * outWidth + frameOrigin + x) * 4;
          out[dest] = rgba[source] ?? 0;
          out[dest + 1] = rgba[source + 1] ?? 0;
          out[dest + 2] = rgba[source + 2] ?? 0;
          out[dest + 3] = rgba[source + 3] ?? 0;
          mask[y * outWidth + frameOrigin + x] = labels[y * cell + x] ?? null;
        }
      }
      frameIndex += 1;
    }
  }
  return { rgba: out, mask, width: outWidth, height: cell };
}

/** A tiny 8-frame walk used by the rig tests. */
export function sampleReference(): ReferenceSheet {
  const frameWidth = 20;
  const frameHeight = 24;
  const width = frameWidth * 8;
  const height = frameHeight;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const mask: (PartCategory | null)[] = new Array(width * height).fill(null);
  for (let frame = 0; frame < 8; frame += 1) {
    const bob = frame % 2 === 0 ? 0 : -1;
    const ox = frame * frameWidth;
    for (let y = 1; y <= 5; y += 1) {
      for (let x = 8; x <= 12; x += 1) {
        paintDot(rgba, mask, width, ox + x, y + bob, y === 4 ? MILITARY.bone : MILITARY.steel, "head");
      }
    }
    for (let y = 6; y <= 12; y += 1) {
      for (let x = 7; x <= 13; x += 1) {
        paintDot(rgba, mask, width, ox + x, y + bob, MILITARY.feldgrau, "torso");
      }
    }
    for (let x = 13; x <= 18; x += 1) {
      paintDot(rgba, mask, width, ox + x, 8 + bob, MILITARY.steel, "weapon");
    }
    paintDot(rgba, mask, width, ox + 12, 9 + bob, MILITARY.brown, "weapon");
    const step = frame % 2;
    for (let y = 13; y <= 20; y += 1) {
      paintDot(rgba, mask, width, ox + 8 + step, y, MILITARY.brown, "legs");
      paintDot(rgba, mask, width, ox + 12 - step, y, MILITARY.brown, "legs");
    }
  }
  return { rgba, mask, width, height };
}
