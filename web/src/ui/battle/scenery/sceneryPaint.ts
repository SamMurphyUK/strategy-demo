// Paints a region scene in the battle board's 16-colour pixel style. Every random choice comes
// from the scene seed, so painting the same scene twice gives the same picture.
import { MILITARY as P } from "../../theme/militaryPalette";
import {
  sceneRandom,
  type Biome,
  type Culture,
  type Landmark,
  type LandScene,
  type Ocean,
  type SeaScene,
} from "./regionScene";

export type Paint = Pick<
  CanvasRenderingContext2D,
  | "fillRect"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "closePath"
  | "fill"
  | "stroke"
  | "arc"
  | "ellipse"
  | "save"
  | "restore"
> & {
  fillStyle: CanvasRenderingContext2D["fillStyle"];
  strokeStyle: CanvasRenderingContext2D["strokeStyle"];
  lineWidth: number;
  globalAlpha: number;
};

type Rand = () => number;

export const HORIZON_Y = 114;
export const GROUND_TOP = 114;
export const GROUND_BOTTOM = 530;
export const EDGE_TOP = 525;

/** No-man's land between the two trench lines. Units only cross it in the victory advance. */
const NO_MANS_LAND = { left: 490, right: 790 };
const WIRE = { left: 610, right: 670 };

export interface GroundTones {
  base: string;
  patch: string;
  dirt: string;
  accent: string;
}

const BIOME_GROUND: Record<Biome, GroundTones> = {
  temperate: { base: P.olive, patch: P.sage, dirt: P.brown, accent: P.spruce },
  boreal: { base: P.bone, patch: P.cream, dirt: P.taupe, accent: P.feldgrau },
  steppe: { base: P.khaki, patch: P.brass, dirt: P.brown, accent: P.tan },
  mediterranean: { base: P.tan, patch: P.olive, dirt: P.terracotta, accent: P.sage },
  desert: { base: P.tan, patch: P.cream, dirt: P.terracotta, accent: P.khaki },
  savanna: { base: P.khaki, patch: P.tan, dirt: P.brown, accent: P.olive },
  jungle: { base: P.spruce, patch: P.olive, dirt: P.brown, accent: P.sage },
  paddy: { base: P.sage, patch: P.spruce, dirt: P.brown, accent: P.olive },
};

/** Ground colours for a land scene. Island beaches override the biome. */
export function groundTones(scene: LandScene): GroundTones {
  if (scene.island === "pacific") return { base: P.cream, patch: P.tan, dirt: P.khaki, accent: P.sage };
  if (scene.island === "atlantic") return { base: P.sage, patch: P.olive, dirt: P.brown, accent: P.bone };
  return BIOME_GROUND[scene.biome];
}

function rect(ctx: Paint, color: string, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function poly(ctx: Paint, color: string, points: number[]): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  ctx.closePath();
  ctx.fill();
}

function disc(ctx: Paint, color: string, x: number, y: number, r: number, half = false): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, half ? Math.PI : 0, Math.PI * 2);
  ctx.fill();
}

function oval(ctx: Paint, color: string, x: number, y: number, rx: number, ry: number): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
  ctx.fill();
}

function line(ctx: Paint, color: string, width: number, points: number[]): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  ctx.stroke();
}

function between(rand: Rand, lo: number, hi: number): number {
  return lo + rand() * (hi - lo);
}

function pick<T>(rand: Rand, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length) % items.length];
}

// ============================================================================
// HORIZON: far terrain, vegetation, buildings and landmarks above the board
// ============================================================================

function paintRidge(ctx: Paint, rand: Rand, width: number, base: number, color: string, height: number, step: number): void {
  const points = [0, base];
  let y = base - height * between(rand, 0.3, 0.8);
  for (let x = 0; x <= width + step; x += step) {
    y = Math.max(base - height, Math.min(base - 4, y + between(rand, -height * 0.35, height * 0.35)));
    points.push(x, Math.round(y));
  }
  points.push(width, base);
  poly(ctx, color, points);
}

function paintFarTerrain(ctx: Paint, scene: LandScene, rand: Rand, width: number): void {
  const b = HORIZON_Y;
  switch (scene.biome) {
    case "boreal":
      paintRidge(ctx, rand, width, b, P.steel, 30, 46);
      for (let x = 20; x < width; x += 90) rect(ctx, P.bone, x + between(rand, 0, 40), b - 26, 14, 2);
      break;
    case "mediterranean":
    case "paddy":
      paintRidge(ctx, rand, width, b, P.steel, 34, 40);
      paintRidge(ctx, rand, width, b, P.spruce, 18, 30);
      break;
    case "desert":
      paintRidge(ctx, rand, width, b, P.khaki, 16, 70);
      paintRidge(ctx, rand, width, b, P.terracotta, 8, 54);
      break;
    case "savanna":
      paintRidge(ctx, rand, width, b, P.taupe, 12, 80);
      break;
    case "jungle":
      paintRidge(ctx, rand, width, b, P.steel, 26, 36);
      break;
    case "steppe":
      paintRidge(ctx, rand, width, b, P.feldgrau, 6, 90);
      break;
    default:
      paintRidge(ctx, rand, width, b, P.steel, 14, 60);
  }
}

function paintTree(ctx: Paint, biome: Biome, x: number, b: number, h: number, rand: Rand): void {
  switch (biome) {
    case "boreal": {
      rect(ctx, P.charcoal, x + 4, b - 5, 2, 5);
      const t = b - h;
      rect(ctx, P.spruce, x + 4, t, 2, 3);
      rect(ctx, P.spruce, x + 2, t + 3, 6, 4);
      rect(ctx, P.spruce, x, t + 7, 10, 5);
      rect(ctx, P.spruce, x - 2, t + 12, 14, h - 15);
      rect(ctx, P.cream, x + 3, t + 2, 4, 1);
      rect(ctx, P.cream, x + 1, t + 7, 8, 1);
      rect(ctx, P.cream, x - 1, t + 12, 12, 1);
      return;
    }
    case "mediterranean": {
      if (rand() < 0.5) {
        rect(ctx, P.charcoal, x + 3, b - 4, 2, 4);
        oval(ctx, P.spruce, x + 4, b - h / 2 - 2, 3, h / 2);
      } else {
        rect(ctx, P.brown, x + 4, b - 6, 2, 6);
        oval(ctx, P.sage, x + 5, b - 9, 7, 4);
        oval(ctx, P.olive, x + 4, b - 8, 4, 2);
      }
      return;
    }
    case "desert": {
      rect(ctx, P.brown, x + 4, b - h, 2, h);
      line(ctx, P.olive, 2, [x + 5, b - h, x - 2, b - h + 4]);
      line(ctx, P.olive, 2, [x + 5, b - h, x + 12, b - h + 4]);
      line(ctx, P.olive, 2, [x + 5, b - h, x + 1, b - h - 3]);
      line(ctx, P.olive, 2, [x + 5, b - h, x + 10, b - h - 3]);
      return;
    }
    case "savanna": {
      if (rand() < 0.75) {
        rect(ctx, P.brown, x + 5, b - h + 4, 2, h - 4);
        line(ctx, P.brown, 1, [x + 6, b - h + 6, x + 1, b - h + 3]);
        oval(ctx, P.olive, x + 6, b - h + 2, 10, 3);
        rect(ctx, P.sage, x, b - h, 10, 1);
      } else {
        rect(ctx, P.feldgrau, x + 2, b - h + 4, 7, h - 4);
        oval(ctx, P.olive, x + 5, b - h + 3, 7, 3);
      }
      return;
    }
    case "jungle": {
      if (rand() < 0.4) {
        paintTree(ctx, "desert", x, b, h, rand);
      } else {
        rect(ctx, P.charcoal, x + 4, b - 6, 3, 6);
        oval(ctx, P.spruce, x + 5, b - h / 2, 9, h / 2);
        oval(ctx, P.olive, x + 3, b - h / 2 - 2, 5, h / 3);
      }
      return;
    }
    case "paddy": {
      for (let i = 0; i < 4; i++) line(ctx, P.olive, 1, [x + i * 2, b, x + i * 2 + 2, b - h + i * 2]);
      oval(ctx, P.sage, x + 5, b - h + 3, 5, 3);
      return;
    }
    case "steppe": {
      if (rand() < 0.5) {
        rect(ctx, P.charcoal, x + 4, b - 5, 2, 5);
        oval(ctx, P.olive, x + 5, b - h / 2 - 2, 3, h / 2);
      } else {
        oval(ctx, P.brass, x + 5, b - 4, 6, 4);
        rect(ctx, P.khaki, x, b - 2, 10, 2);
      }
      return;
    }
    default: {
      rect(ctx, P.charcoal, x + 4, b - 6, 2, 6);
      oval(ctx, P.olive, x + 5, b - h / 2 - 2, 7, h / 2);
      oval(ctx, P.sage, x + 3, b - h / 2 - 5, 3, h / 4);
    }
  }
}

function paintVegetation(ctx: Paint, scene: LandScene, rand: Rand, width: number, density: number): void {
  const b = HORIZON_Y;
  const step = scene.biome === "boreal" ? 16 : scene.biome === "desert" ? 70 : 20;
  for (let x = -6; x < width + 10; x += step) {
    if (rand() > density) continue;
    const h = between(rand, 14, scene.biome === "boreal" ? 32 : 26);
    paintTree(ctx, scene.biome, x + between(rand, -4, 4), b, h, rand);
  }
}

interface BuildingStyle {
  walls: readonly string[];
  roof: string;
  windows: string;
}

const STYLE: Record<Culture, BuildingStyle> = {
  german: { walls: [P.bone, P.feldgrau, P.cream], roof: P.crimson, windows: P.charcoal },
  british: { walls: [P.brown, P.terracotta, P.khaki], roof: P.steel, windows: P.cream },
  western: { walls: [P.cream, P.bone, P.tan], roof: P.steel, windows: P.charcoal },
  nordic: { walls: [P.crimson, P.khaki, P.bone], roof: P.charcoal, windows: P.cream },
  russian: { walls: [P.cream, P.sage, P.bone], roof: P.sage, windows: P.charcoal },
  mediterranean: { walls: [P.cream, P.tan, P.bone], roof: P.terracotta, windows: P.charcoal },
  arab: { walls: [P.cream, P.tan, P.khaki], roof: P.tan, windows: P.charcoal },
  african: { walls: [P.tan, P.brown, P.khaki], roof: P.khaki, windows: P.charcoal },
  indian: { walls: [P.tan, P.cream, P.terracotta], roof: P.terracotta, windows: P.charcoal },
  chinese: { walls: [P.bone, P.terracotta, P.cream], roof: P.charcoal, windows: P.crimson },
  japanese: { walls: [P.bone, P.cream, P.brown], roof: P.charcoal, windows: P.brown },
  american: { walls: [P.brown, P.bone, P.feldgrau], roof: P.charcoal, windows: P.cream },
  latin: { walls: [P.cream, P.khaki, P.terracotta], roof: P.terracotta, windows: P.charcoal },
  oceanic: { walls: [P.khaki, P.brown, P.tan], roof: P.brass, windows: P.charcoal },
};

function paintWindows(ctx: Paint, color: string, x: number, top: number, w: number, h: number): void {
  for (let wy = top + 3; wy < top + h - 3; wy += 5) {
    for (let wx = x + 2; wx < x + w - 2; wx += 4) rect(ctx, color, wx, wy, 1, 2);
  }
}

/** One house or block on the skyline. `far` draws a flat silhouette for the back row. */
function paintBuilding(ctx: Paint, culture: Culture, x: number, w: number, h: number, far: boolean, rand: Rand): void {
  const b = HORIZON_Y;
  const style = STYLE[culture];
  const wall = far ? P.steel : pick(rand, style.walls);
  const roof = far ? P.charcoal : style.roof;
  const top = b - h;
  switch (culture) {
    case "german":
    case "nordic":
    case "british":
    case "western": {
      rect(ctx, wall, x, top, w, h);
      const pitch = culture === "british" || culture === "western" ? w * 0.35 : w * 0.6;
      if (culture === "western" && rand() < 0.5) {
        poly(ctx, roof, [x - 1, top, x + 3, top - pitch * 0.6, x + w - 3, top - pitch * 0.6, x + w + 1, top]);
      } else {
        poly(ctx, roof, [x - 1, top, x + w / 2, top - pitch, x + w + 1, top]);
      }
      if (culture === "british") rect(ctx, far ? roof : P.brown, x + w - 5, top - pitch - 4, 3, pitch);
      if (culture === "german" && !far) {
        rect(ctx, P.brown, x, top + h / 2, w, 1);
        rect(ctx, P.brown, x + w / 2, top, 1, h);
      }
      break;
    }
    case "russian": {
      rect(ctx, wall, x, top, w, h);
      poly(ctx, roof, [x - 1, top, x + w / 2, top - w * 0.3, x + w + 1, top]);
      break;
    }
    case "mediterranean":
    case "latin": {
      rect(ctx, wall, x, top, w, h);
      poly(ctx, roof, [x - 1, top, x + w / 2, top - w * 0.18, x + w + 1, top]);
      break;
    }
    case "arab":
    case "indian": {
      rect(ctx, wall, x, top, w, h);
      for (let px = x; px < x + w; px += 4) rect(ctx, wall, px, top - 2, 2, 2);
      if (!far && rand() < 0.3) disc(ctx, culture === "indian" ? P.cream : P.sage, x + w / 2, top, w / 3, true);
      break;
    }
    case "african":
    case "oceanic": {
      const hutW = Math.min(w, 18);
      if (culture === "oceanic") {
        rect(ctx, P.brown, x + 2, b - 4, 1, 4);
        rect(ctx, P.brown, x + hutW - 3, b - 4, 1, 4);
        rect(ctx, wall, x + 1, b - 4 - h * 0.4, hutW - 2, h * 0.4);
        poly(ctx, roof, [x - 2, b - 4 - h * 0.4, x + hutW / 2, b - 6 - h * 0.9, x + hutW + 2, b - 4 - h * 0.4]);
      } else {
        rect(ctx, wall, x + 1, b - h * 0.45, hutW - 2, h * 0.45);
        poly(ctx, roof, [x - 2, b - h * 0.45, x + hutW / 2, b - h, x + hutW + 2, b - h * 0.45]);
      }
      return;
    }
    case "chinese":
    case "japanese": {
      rect(ctx, wall, x + 1, top + 2, w - 2, h - 2);
      poly(ctx, roof, [x - 4, top + 3, x - 1, top - 1, x + w / 2, top - w * 0.25, x + w + 1, top - 1, x + w + 4, top + 3]);
      break;
    }
    case "american": {
      rect(ctx, wall, x, top, w, h);
      rect(ctx, roof, x - 1, top - 2, w + 2, 2);
      if (!far && h > 30 && rand() < 0.4) {
        rect(ctx, P.brown, x + w / 2 - 4, top - 10, 8, 6);
        rect(ctx, P.charcoal, x + w / 2 - 3, top - 4, 1, 2);
        rect(ctx, P.charcoal, x + w / 2 + 2, top - 4, 1, 2);
      }
      break;
    }
  }
  if (!far) paintWindows(ctx, style.windows, x, top, w, h);
}

/** The tall building a town gathers round: spire, minaret, pagoda, onion dome, water tower. */
function paintTownMark(ctx: Paint, culture: Culture, x: number, rand: Rand): void {
  const b = HORIZON_Y;
  switch (culture) {
    case "russian":
      rect(ctx, P.cream, x - 6, b - 30, 12, 30);
      rect(ctx, P.cream, x - 3, b - 40, 6, 10);
      oval(ctx, P.brass, x, b - 44, 5, 6);
      poly(ctx, P.brass, [x - 1, b - 49, x, b - 56, x + 1, b - 49]);
      break;
    case "arab":
    case "indian":
      rect(ctx, P.cream, x - 3, b - 54, 6, 54);
      rect(ctx, P.tan, x - 5, b - 40, 10, 2);
      oval(ctx, culture === "arab" ? P.sage : P.cream, x, b - 56, 3, 4);
      if (culture === "indian") {
        rect(ctx, P.tan, x + 8, b - 20, 22, 20);
        disc(ctx, P.cream, x + 19, b - 20, 9, true);
      }
      break;
    case "chinese":
    case "japanese": {
      const tiers = culture === "japanese" ? 5 : 4;
      for (let i = 0; i < tiers; i++) {
        const tw = 18 - i * 2.5;
        const ty = b - 10 - i * 10;
        rect(ctx, P.crimson, x - tw / 2 + 2, ty, tw - 4, 10);
        poly(ctx, P.charcoal, [x - tw / 2 - 4, ty + 1, x - tw / 2, ty - 2, x + tw / 2, ty - 2, x + tw / 2 + 4, ty + 1]);
      }
      rect(ctx, P.brass, x - 1, b - 10 - tiers * 10 - 6, 2, 8);
      break;
    }
    case "american":
      rect(ctx, P.charcoal, x - 6, b - 26, 1, 26);
      rect(ctx, P.charcoal, x + 5, b - 26, 1, 26);
      oval(ctx, P.feldgrau, x, b - 32, 9, 7);
      poly(ctx, P.charcoal, [x - 9, b - 36, x, b - 42, x + 9, b - 36]);
      break;
    case "mediterranean":
    case "latin":
      rect(ctx, P.cream, x - 5, b - 46, 10, 46);
      rect(ctx, P.charcoal, x - 2, b - 40, 4, 5);
      poly(ctx, P.terracotta, [x - 6, b - 46, x, b - 52, x + 6, b - 46]);
      if (culture === "latin") {
        rect(ctx, P.cream, x + 6, b - 24, 20, 24);
        rect(ctx, P.cream, x + 22, b - 46, 10, 46);
        poly(ctx, P.terracotta, [x + 21, b - 46, x + 27, b - 52, x + 33, b - 46]);
      }
      break;
    case "african":
    case "oceanic":
      paintTree(ctx, culture === "african" ? "savanna" : "jungle", x - 6, b, 34, rand);
      break;
    default:
      rect(ctx, culture === "british" ? P.khaki : P.bone, x - 5, b - 34, 10, 34);
      rect(ctx, P.charcoal, x - 2, b - 30, 4, 5);
      poly(ctx, P.steel, [x - 6, b - 34, x, b - 62, x + 6, b - 34]);
  }
}

function paintChimneys(ctx: Paint, x: number, rand: Rand): void {
  const b = HORIZON_Y;
  rect(ctx, P.charcoal, x - 26, b - 16, 52, 16);
  for (let i = 0; i < 4; i++) poly(ctx, P.taupe, [x - 26 + i * 13, b - 16, x - 26 + i * 13, b - 24, x - 13 + i * 13, b - 16]);
  const stacks = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < stacks; i++) {
    const sx = x - 18 + i * 14;
    const sh = between(rand, 34, 50);
    rect(ctx, P.charcoal, sx, b - sh, 5, sh);
    rect(ctx, P.crimson, sx, b - sh + 4, 5, 2);
  }
}

// ---------------------------------------------------------------------------
// Landmarks. Each sits on the horizon at x and returns nothing; widths are noted.
// ---------------------------------------------------------------------------

const LANDMARK_WIDTH: Record<Landmark, number> = {
  brandenburg_gate: 70, reichstag: 120, flak_tower: 56, big_ben: 96, st_pauls: 76, tower_bridge: 120,
  kremlin: 160, st_basils: 64, admiralty_spire: 80, capitol: 130, washington_monument: 14, empire_state: 34,
  golden_gate: 240, diet_building: 90, pagoda: 34, mount_fuji: 280, colosseum: 90, st_peters: 90,
  eiffel_tower: 52, windmill: 34, parthenon: 110, hagia_sophia: 110, pyramids: 170, dome_of_the_rock: 60,
  mughal_dome: 100, rock_of_gibraltar: 200, table_mountain: 260, harbour_bridge: 200, diamond_head: 220, suribachi: 120,
};

/** Mountains and bridges stand behind the skyline; buildings stand in front of it. */
const BACKDROP: ReadonlySet<Landmark> = new Set<Landmark>([
  "mount_fuji", "rock_of_gibraltar", "table_mountain", "diamond_head", "suribachi", "golden_gate", "harbour_bridge", "pyramids",
]);

export function landmarkWidth(mark: Landmark): number {
  return LANDMARK_WIDTH[mark];
}

function paintLandmark(ctx: Paint, mark: Landmark, x: number): void {
  const b = HORIZON_Y;
  switch (mark) {
    case "brandenburg_gate":
      rect(ctx, P.taupe, x - 35, b - 3, 70, 3);
      for (let i = 0; i < 6; i++) rect(ctx, P.bone, x - 31 + i * 12, b - 28, 5, 25);
      rect(ctx, P.bone, x - 34, b - 35, 68, 7);
      rect(ctx, P.taupe, x - 34, b - 29, 68, 1);
      rect(ctx, P.bone, x - 12, b - 40, 24, 5);
      rect(ctx, P.brass, x - 7, b - 46, 14, 6);
      rect(ctx, P.brass, x - 8, b - 49, 3, 3);
      rect(ctx, P.brass, x + 5, b - 49, 3, 3);
      rect(ctx, P.brass, x - 1, b - 52, 2, 6);
      return;
    case "reichstag":
      rect(ctx, P.feldgrau, x - 52, b - 26, 104, 26);
      rect(ctx, P.feldgrau, x - 60, b - 34, 16, 34);
      rect(ctx, P.feldgrau, x + 44, b - 34, 16, 34);
      for (let i = 0; i < 6; i++) rect(ctx, P.bone, x - 15 + i * 6, b - 22, 3, 20);
      poly(ctx, P.bone, [x - 18, b - 26, x, b - 34, x + 18, b - 26]);
      rect(ctx, P.steel, x - 14, b - 44, 28, 10);
      disc(ctx, P.steel, x, b - 44, 14, true);
      for (let i = -2; i <= 2; i++) rect(ctx, P.charcoal, x + i * 5, b - 54, 1, 20);
      paintWindows(ctx, P.charcoal, x - 50, b - 26, 30, 26);
      paintWindows(ctx, P.charcoal, x + 20, b - 26, 30, 26);
      return;
    case "flak_tower":
      rect(ctx, P.feldgrau, x - 24, b - 52, 48, 52);
      for (const dx of [-28, 16]) {
        rect(ctx, P.taupe, x + dx, b - 60, 12, 10);
        line(ctx, P.charcoal, 2, [x + dx + 6, b - 60, x + dx + 14, b - 68]);
      }
      rect(ctx, P.taupe, x - 24, b - 52, 48, 2);
      for (let wy = b - 44; wy < b - 4; wy += 9) {
        rect(ctx, P.charcoal, x - 16, wy, 4, 3);
        rect(ctx, P.charcoal, x + 12, wy, 4, 3);
      }
      return;
    case "big_ben":
      rect(ctx, P.khaki, x - 48, b - 22, 76, 22);
      for (let px = x - 48; px < x + 28; px += 8) poly(ctx, P.khaki, [px, b - 22, px + 2, b - 28, px + 4, b - 22]);
      paintWindows(ctx, P.brown, x - 48, b - 22, 76, 22);
      rect(ctx, P.khaki, x + 30, b - 70, 14, 70);
      rect(ctx, P.cream, x + 31, b - 62, 12, 12);
      disc(ctx, P.cream, x + 37, b - 56, 5);
      rect(ctx, P.charcoal, x + 37, b - 59, 1, 3);
      rect(ctx, P.charcoal, x + 37, b - 56, 3, 1);
      poly(ctx, P.steel, [x + 29, b - 70, x + 37, b - 90, x + 45, b - 70]);
      rect(ctx, P.brass, x + 36, b - 94, 2, 4);
      return;
    case "st_pauls":
      rect(ctx, P.bone, x - 36, b - 20, 72, 20);
      rect(ctx, P.bone, x - 36, b - 34, 10, 14);
      rect(ctx, P.bone, x + 26, b - 34, 10, 14);
      rect(ctx, P.bone, x - 16, b - 34, 32, 14);
      for (let i = 0; i < 5; i++) rect(ctx, P.taupe, x - 13 + i * 6, b - 32, 2, 12);
      disc(ctx, P.steel, x, b - 34, 16, true);
      rect(ctx, P.bone, x - 3, b - 56, 6, 6);
      disc(ctx, P.bone, x, b - 56, 3, true);
      rect(ctx, P.brass, x - 1, b - 62, 2, 4);
      return;
    case "tower_bridge":
      rect(ctx, P.steel, x - 60, b - 10, 120, 3);
      for (const dx of [-36, 24]) {
        rect(ctx, P.bone, x + dx, b - 48, 12, 48);
        poly(ctx, P.steel, [x + dx - 1, b - 48, x + dx + 6, b - 58, x + dx + 13, b - 48]);
        rect(ctx, P.charcoal, x + dx + 4, b - 40, 4, 8);
      }
      rect(ctx, P.steel, x - 24, b - 42, 48, 4);
      line(ctx, P.steel, 1, [x - 60, b - 30, x - 36, b - 44]);
      line(ctx, P.steel, 1, [x + 36, b - 44, x + 60, b - 30]);
      return;
    case "kremlin": {
      rect(ctx, P.crimson, x - 80, b - 14, 160, 14);
      for (let px = x - 80; px < x + 80; px += 6) rect(ctx, P.crimson, px, b - 18, 3, 4);
      for (const dx of [-70, 60]) {
        rect(ctx, P.crimson, x + dx, b - 30, 10, 30);
        poly(ctx, P.sage, [x + dx - 1, b - 30, x + dx + 5, b - 42, x + dx + 11, b - 30]);
      }
      rect(ctx, P.crimson, x - 8, b - 44, 16, 44);
      rect(ctx, P.cream, x - 6, b - 40, 12, 8);
      disc(ctx, P.charcoal, x, b - 36, 3);
      rect(ctx, P.crimson, x - 5, b - 54, 10, 10);
      poly(ctx, P.sage, [x - 6, b - 54, x, b - 70, x + 6, b - 54]);
      poly(ctx, P.crimson, [x, b - 78, x + 2, b - 74, x + 4, b - 74, x + 2, b - 72, x + 3, b - 69, x, b - 71, x - 3, b - 69, x - 2, b - 72, x - 4, b - 74, x - 2, b - 74]);
      rect(ctx, P.cream, x + 20, b - 30, 26, 16);
      disc(ctx, P.brass, x + 33, b - 30, 7, true);
      return;
    }
    case "st_basils": {
      rect(ctx, P.crimson, x - 30, b - 22, 60, 22);
      rect(ctx, P.cream, x - 4, b - 50, 8, 28);
      poly(ctx, P.sage, [x - 5, b - 50, x, b - 66, x + 5, b - 50]);
      const domes: [number, number, string, string][] = [[-22, 32, P.brass, P.sage], [-10, 38, P.sage, P.crimson], [12, 36, P.crimson, P.cream], [24, 30, P.spruce, P.brass]];
      for (const [dx, h, a, s] of domes) {
        rect(ctx, P.cream, x + dx - 3, b - h, 6, h - 20);
        oval(ctx, a, x + dx, b - h - 3, 5, 6);
        rect(ctx, s, x + dx - 1, b - h - 8, 2, 10);
        poly(ctx, a, [x + dx - 1, b - h - 8, x + dx, b - h - 13, x + dx + 1, b - h - 8]);
      }
      return;
    }
    case "admiralty_spire":
      rect(ctx, P.brass, x - 40, b - 18, 80, 18);
      paintWindows(ctx, P.cream, x - 40, b - 18, 80, 18);
      rect(ctx, P.brass, x - 8, b - 34, 16, 16);
      rect(ctx, P.cream, x - 4, b - 30, 8, 10);
      poly(ctx, P.brass, [x - 3, b - 34, x, b - 84, x + 3, b - 34]);
      return;
    case "capitol":
      rect(ctx, P.cream, x - 65, b - 18, 130, 18);
      paintWindows(ctx, P.bone, x - 65, b - 18, 130, 18);
      rect(ctx, P.cream, x - 18, b - 30, 36, 12);
      for (let i = 0; i < 7; i++) rect(ctx, P.bone, x - 16 + i * 5, b - 28, 2, 10);
      rect(ctx, P.cream, x - 12, b - 42, 24, 12);
      disc(ctx, P.cream, x, b - 42, 13, true);
      rect(ctx, P.bone, x - 13, b - 43, 26, 1);
      rect(ctx, P.cream, x - 3, b - 60, 6, 6);
      rect(ctx, P.bone, x - 1, b - 66, 2, 6);
      return;
    case "washington_monument":
      poly(ctx, P.cream, [x - 6, b, x - 4, b - 76, x + 4, b - 76, x + 6, b]);
      poly(ctx, P.cream, [x - 4, b - 76, x, b - 84, x + 4, b - 76]);
      rect(ctx, P.bone, x + 2, b - 76, 2, 76);
      return;
    case "empire_state":
      rect(ctx, P.bone, x - 17, b - 50, 34, 50);
      rect(ctx, P.bone, x - 12, b - 72, 24, 22);
      rect(ctx, P.bone, x - 8, b - 86, 16, 14);
      rect(ctx, P.feldgrau, x - 5, b - 94, 10, 8);
      rect(ctx, P.feldgrau, x - 1, b - 108, 2, 14);
      paintWindows(ctx, P.feldgrau, x - 17, b - 50, 34, 50);
      paintWindows(ctx, P.feldgrau, x - 12, b - 72, 24, 22);
      return;
    case "golden_gate":
      for (const dx of [-70, 70]) {
        rect(ctx, P.terracotta, x + dx - 3, b - 62, 6, 62);
        rect(ctx, P.terracotta, x + dx - 5, b - 50, 10, 2);
        rect(ctx, P.terracotta, x + dx - 5, b - 30, 10, 2);
      }
      rect(ctx, P.terracotta, x - 120, b - 18, 240, 3);
      line(ctx, P.terracotta, 1, [x - 120, b - 18, x - 70, b - 62]);
      line(ctx, P.terracotta, 1, [x - 70, b - 62, x - 40, b - 30, x, b - 20, x + 40, b - 30, x + 70, b - 62]);
      line(ctx, P.terracotta, 1, [x + 70, b - 62, x + 120, b - 18]);
      return;
    case "diet_building":
      rect(ctx, P.bone, x - 45, b - 22, 90, 22);
      paintWindows(ctx, P.taupe, x - 45, b - 22, 90, 22);
      rect(ctx, P.bone, x - 12, b - 40, 24, 18);
      for (let i = 0; i < 4; i++) rect(ctx, P.bone, x - 10 + i * 2, b - 48 - i * 4, 20 - i * 4, 4);
      poly(ctx, P.bone, [x - 3, b - 60, x, b - 66, x + 3, b - 60]);
      return;
    case "pagoda":
      paintTownMark(ctx, "japanese", x, () => 0.5);
      return;
    case "mount_fuji":
      poly(ctx, P.steel, [x - 140, b, x - 26, b - 62, x + 26, b - 62, x + 140, b]);
      poly(ctx, P.cream, [x - 40, b - 50, x - 26, b - 62, x + 26, b - 62, x + 40, b - 50, x + 24, b - 46, x + 10, b - 52, x - 6, b - 44, x - 22, b - 50]);
      return;
    case "colosseum":
      poly(ctx, P.tan, [x - 45, b, x - 45, b - 30, x + 20, b - 34, x + 45, b - 22, x + 45, b]);
      for (let row = 0; row < 3; row++) {
        for (let i = 0; i < 9; i++) {
          const ax = x - 41 + i * 9;
          const ay = b - 9 - row * 9;
          if (ay < b - 30 + (ax - x) * 0.1 && ax > x + 10) continue;
          rect(ctx, P.brown, ax, ay, 4, 6);
        }
      }
      return;
    case "st_peters":
      rect(ctx, P.cream, x - 45, b - 22, 90, 22);
      for (let i = 0; i < 8; i++) rect(ctx, P.bone, x - 40 + i * 11, b - 20, 3, 18);
      rect(ctx, P.cream, x - 14, b - 36, 28, 14);
      disc(ctx, P.steel, x, b - 36, 15, true);
      for (let i = -2; i <= 2; i++) rect(ctx, P.bone, x + i * 5, b - 48 + Math.abs(i) * 2, 1, 10);
      rect(ctx, P.cream, x - 3, b - 58, 6, 7);
      rect(ctx, P.brass, x - 1, b - 63, 2, 5);
      return;
    case "eiffel_tower":
      poly(ctx, P.brown, [x - 24, b, x - 6, b - 46, x - 3, b - 80, x + 3, b - 80, x + 6, b - 46, x + 24, b]);
      disc(ctx, P.charcoal, x, b, 12, true);
      rect(ctx, P.charcoal, x - 6, b - 2, 12, 2);
      rect(ctx, P.brown, x - 14, b - 22, 28, 3);
      rect(ctx, P.brown, x - 8, b - 46, 16, 3);
      for (let ly = b - 76; ly < b - 4; ly += 6) rect(ctx, P.khaki, x - 1, ly, 2, 2);
      rect(ctx, P.brown, x - 1, b - 92, 2, 12);
      return;
    case "windmill":
      poly(ctx, P.brown, [x - 10, b, x - 6, b - 34, x + 6, b - 34, x + 10, b]);
      poly(ctx, P.charcoal, [x - 8, b - 34, x, b - 42, x + 8, b - 34]);
      line(ctx, P.cream, 2, [x - 18, b - 56, x + 18, b - 20]);
      line(ctx, P.cream, 2, [x + 18, b - 56, x - 18, b - 20]);
      rect(ctx, P.charcoal, x - 2, b - 40, 4, 4);
      return;
    case "parthenon":
      poly(ctx, P.brown, [x - 60, b, x - 44, b - 16, x + 44, b - 18, x + 60, b]);
      rect(ctx, P.cream, x - 36, b - 20, 72, 3);
      for (let i = 0; i < 8; i++) rect(ctx, P.cream, x - 34 + i * 9, b - 38, 4, 18);
      rect(ctx, P.cream, x - 38, b - 42, 76, 4);
      poly(ctx, P.cream, [x - 38, b - 42, x, b - 50, x + 38, b - 42]);
      return;
    case "hagia_sophia":
      rect(ctx, P.terracotta, x - 34, b - 24, 68, 24);
      disc(ctx, P.steel, x - 22, b - 24, 10, true);
      disc(ctx, P.steel, x + 22, b - 24, 10, true);
      rect(ctx, P.terracotta, x - 14, b - 34, 28, 10);
      disc(ctx, P.steel, x, b - 34, 16, true);
      rect(ctx, P.brass, x - 1, b - 54, 2, 4);
      for (const dx of [-50, -40, 40, 50]) {
        rect(ctx, P.cream, x + dx - 2, b - 58, 4, 58);
        poly(ctx, P.steel, [x + dx - 2, b - 58, x + dx, b - 66, x + dx + 2, b - 58]);
      }
      return;
    case "pyramids":
      for (const [dx, h] of [[-50, 46], [20, 58], [70, 28]] as const) {
        poly(ctx, P.khaki, [x + dx - h, b, x + dx, b - h, x + dx + h, b]);
        poly(ctx, P.tan, [x + dx, b - h, x + dx + h, b, x + dx + h * 0.3, b]);
      }
      return;
    case "dome_of_the_rock":
      rect(ctx, P.steel, x - 28, b - 22, 56, 22);
      for (let i = 0; i < 7; i++) rect(ctx, P.sage, x - 25 + i * 8, b - 18, 3, 8);
      rect(ctx, P.steel, x - 12, b - 30, 24, 8);
      disc(ctx, P.brass, x, b - 30, 13, true);
      rect(ctx, P.brass, x - 1, b - 47, 2, 4);
      return;
    case "mughal_dome":
      rect(ctx, P.cream, x - 50, b - 6, 100, 6);
      rect(ctx, P.cream, x - 26, b - 32, 52, 26);
      rect(ctx, P.bone, x - 6, b - 28, 12, 20);
      rect(ctx, P.cream, x - 10, b - 38, 20, 6);
      oval(ctx, P.cream, x, b - 48, 15, 13);
      rect(ctx, P.brass, x - 1, b - 66, 2, 6);
      for (const dx of [-44, 44]) {
        rect(ctx, P.cream, x + dx - 2, b - 46, 4, 40);
        oval(ctx, P.cream, x + dx, b - 48, 3, 3);
      }
      return;
    case "rock_of_gibraltar":
      poly(ctx, P.bone, [x - 100, b, x - 30, b - 30, x + 40, b - 62, x + 70, b - 56, x + 100, b]);
      poly(ctx, P.taupe, [x + 40, b - 62, x + 70, b - 56, x + 100, b, x + 60, b]);
      return;
    case "table_mountain":
      poly(ctx, P.steel, [x - 130, b, x - 80, b - 50, x + 80, b - 52, x + 130, b]);
      rect(ctx, P.cream, x - 76, b - 56, 152, 4);
      rect(ctx, P.cream, x - 50, b - 59, 90, 3);
      return;
    case "harbour_bridge":
      line(ctx, P.steel, 3, [x - 90, b - 16, x - 60, b - 42, x, b - 54, x + 60, b - 42, x + 90, b - 16]);
      rect(ctx, P.steel, x - 100, b - 16, 200, 3);
      for (let i = -4; i <= 4; i++) rect(ctx, P.steel, x + i * 18, b - 16 - (54 - Math.abs(i) * Math.abs(i) * 2.4), 1, 54 - Math.abs(i) * Math.abs(i) * 2.4);
      for (const dx of [-100, 88]) rect(ctx, P.cream, x + dx, b - 28, 12, 28);
      return;
    case "diamond_head":
      poly(ctx, P.brown, [x - 110, b, x - 60, b - 34, x - 20, b - 26, x + 30, b - 40, x + 70, b - 22, x + 110, b]);
      poly(ctx, P.olive, [x - 90, b, x - 60, b - 22, x - 30, b - 14, x + 20, b - 26, x + 70, b - 10, x + 100, b]);
      return;
    case "suribachi":
      poly(ctx, P.taupe, [x - 60, b, x - 12, b - 44, x + 12, b - 44, x + 60, b]);
      poly(ctx, P.charcoal, [x + 12, b - 44, x + 60, b, x + 30, b]);
      return;
  }
}

function landmarkSlots(scene: LandScene, width: number): { mark: Landmark; x: number }[] {
  const slots = [width * 0.17, width * 0.83, width * 0.5];
  const backdrops = scene.landmarks.filter((m) => BACKDROP.has(m));
  const buildings = scene.landmarks.filter((m) => !BACKDROP.has(m));
  const placed: { mark: Landmark; x: number }[] = [];
  backdrops.forEach((mark, i) => placed.push({ mark, x: slots[(i + 2) % 3] }));
  buildings.forEach((mark, i) => placed.push({ mark, x: slots[i % 3] }));
  return placed;
}

/** Spare horizon space for settlement and vegetation density. */
const SKYLINE: Record<
  LandScene["settlement"],
  { farRow: number; nearRow: number; clusters: number; clusterWidth: number; trees: number; marks: number }
> = {
  capital: { farRow: 0.85, nearRow: 0.9, clusters: 0, clusterWidth: 0, trees: 0.25, marks: 3 },
  city: { farRow: 0.5, nearRow: 0.7, clusters: 0, clusterWidth: 0, trees: 0.4, marks: 2 },
  town: { farRow: 0, nearRow: 0, clusters: 3, clusterWidth: 170, trees: 0.7, marks: 1 },
  village: { farRow: 0, nearRow: 0, clusters: 2, clusterWidth: 80, trees: 0.85, marks: 0 },
  wild: { farRow: 0, nearRow: 0, clusters: 0, clusterWidth: 0, trees: 0.95, marks: 0 },
};

/** Towns and villages gather into a few groups of houses with open country between. */
function paintClusters(
  ctx: Paint,
  scene: LandScene,
  rand: Rand,
  width: number,
  count: number,
  span: number,
  gaps: { x: number; half: number }[],
): number[] {
  const centres: number[] = [];
  for (let i = 0; i < count; i++) {
    const centre = (width / count) * (i + 0.5) + between(rand, -width / count / 4, width / count / 4);
    centres.push(centre);
    let x = centre - span / 2;
    while (x < centre + span / 2) {
      const w = between(rand, 12, 24);
      if (!gaps.some((g) => x + w > g.x - g.half && x < g.x + g.half)) {
        const edge = 1 - Math.abs(x - centre) / (span / 2);
        paintBuilding(ctx, scene.culture, x, w, between(rand, 12, 16 + 14 * edge), false, rand);
      }
      x += w + between(rand, 0, 5);
    }
  }
  return centres;
}

function paintRow(
  ctx: Paint,
  scene: LandScene,
  rand: Rand,
  width: number,
  coverage: number,
  far: boolean,
  gaps: { x: number; half: number }[],
): void {
  const tall = far ? [26, 58] : [14, 32];
  let x = between(rand, -10, 10);
  while (x < width) {
    const w = between(rand, far ? 20 : 14, far ? 40 : 30);
    const blocked = gaps.some((g) => x + w > g.x - g.half && x < g.x + g.half);
    if (!blocked && rand() < coverage) {
      paintBuilding(ctx, scene.culture, x, w, between(rand, tall[0], tall[1]), far, rand);
    }
    x += w + (rand() < coverage ? between(rand, 0, 4) : between(rand, 10, 40));
  }
}

/** Everything above the board: far hills, trees, the settlement skyline and its landmarks. */
export function paintHorizon(ctx: Paint, scene: LandScene, width: number): void {
  const rand = sceneRandom(scene.seed ^ 0x51a7);
  const look = SKYLINE[scene.settlement];
  const marks = landmarkSlots(scene, width);
  const gaps = marks.filter((m) => !BACKDROP.has(m.mark)).map((m) => ({ x: m.x, half: landmarkWidth(m.mark) / 2 + 4 }));

  if (!scene.island) paintFarTerrain(ctx, scene, rand, width);
  for (const m of marks) if (BACKDROP.has(m.mark)) paintLandmark(ctx, m.mark, m.x);
  if (look.farRow > 0) paintRow(ctx, scene, rand, width, look.farRow, true, gaps);
  for (const m of marks) if (!BACKDROP.has(m.mark)) paintLandmark(ctx, m.mark, m.x);
  if (scene.island) {
    paintIslandShore(ctx, scene, rand, width, gaps);
  } else {
    paintVegetation(ctx, scene, rand, width, look.trees);
  }
  if (look.nearRow > 0) paintRow(ctx, scene, rand, width, look.nearRow, false, gaps);
  const centres = look.clusters > 0 ? paintClusters(ctx, scene, rand, width, look.clusters, look.clusterWidth, gaps) : [];

  const free = centres.length > 0 ? centres : [width * 0.33, width * 0.67, width * 0.08, width * 0.92];
  for (let i = 0; i < look.marks; i++) {
    const x = free[i % free.length] + between(rand, -30, 30);
    if (gaps.some((g) => Math.abs(g.x - x) < g.half + 20)) continue;
    paintTownMark(ctx, scene.culture, x, rand);
  }
  if (scene.hasFactory) paintChimneys(ctx, width * 0.4 + between(rand, -60, 60), rand);

  if (!scene.island) paintEmbankment(ctx, groundTones(scene), width);
}

function paintIslandShore(ctx: Paint, scene: LandScene, rand: Rand, width: number, gaps: { x: number; half: number }[]): void {
  const b = HORIZON_Y;
  const pacific = scene.island === "pacific";
  const spits = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < spits; i++) {
    const cx = between(rand, 80, width - 80);
    if (gaps.some((g) => Math.abs(g.x - cx) < g.half)) continue;
    const half = between(rand, 50, 120);
    if (pacific) {
      rect(ctx, P.cream, cx - half, b - 3, half * 2, 3);
      rect(ctx, P.tan, cx - half * 0.7, b - 6, half * 1.4, 3);
      for (let px = cx - half * 0.6; px < cx + half * 0.6; px += between(rand, 14, 26)) {
        paintTree(ctx, "desert", px, b - 5, between(rand, 14, 24), rand);
      }
    } else {
      poly(ctx, P.feldgrau, [cx - half, b, cx - half * 0.6, b - between(rand, 10, 22), cx + half * 0.4, b - between(rand, 14, 26), cx + half, b]);
      poly(ctx, P.sage, [cx - half * 0.7, b - 6, cx - half * 0.4, b - 14, cx + half * 0.3, b - 16, cx + half * 0.6, b - 6]);
      if (rand() < 0.5) {
        const lx = cx + half * 0.5;
        rect(ctx, P.cream, lx - 3, b - 34, 6, 22);
        rect(ctx, P.crimson, lx - 3, b - 28, 6, 4);
        rect(ctx, P.charcoal, lx - 4, b - 38, 8, 4);
        poly(ctx, P.crimson, [lx - 4, b - 38, lx, b - 42, lx + 4, b - 38]);
      }
    }
  }
}

function paintEmbankment(ctx: Paint, tones: GroundTones, width: number): void {
  const b = HORIZON_Y;
  rect(ctx, P.charcoal, 0, b - 2, width, 4);
  for (let x = 0; x < width; x += 6) rect(ctx, tones.accent, x, b - 3, 3, 2);
}

// ============================================================================
// GROUND: the field the two armies stand on (y 114 to 530)
// ============================================================================

function paintCrater(ctx: Paint, x: number, y: number, r: number, dirt: string): void {
  oval(ctx, dirt, x, y, r + 3, r * 0.7 + 2);
  oval(ctx, P.taupe, x, y, r, r * 0.7);
  oval(ctx, P.charcoal, x - 0.5, y - 0.5, r * 0.55, r * 0.35);
}

function paintTrench(ctx: Paint, x: number, top: number, height: number, urban: boolean): void {
  if (urban) {
    for (let y = top; y < top + height; y += 7) {
      rect(ctx, P.terracotta, x - 7 + ((y / 7) % 2) * 3, y, 10, 5);
      rect(ctx, P.brown, x - 7 + ((y / 7) % 2) * 3, y + 4, 10, 1);
    }
    rect(ctx, P.charcoal, x - 8, top, 2, height);
    return;
  }
  rect(ctx, P.taupe, x - 6, top, 12, height);
  for (let ty = top + 4; ty < top + height; ty += 12) rect(ctx, P.brown, x - 4, ty, 8, 4);
  rect(ctx, P.charcoal, x - 6, top, 2, height);
}

function paintSandbags(ctx: Paint, x: number, y: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const sy = y + i * 8;
    rect(ctx, P.tan, x, sy, 7, 5);
    rect(ctx, P.cream, x + 1, sy + 1, 5, 2);
    rect(ctx, P.brown, x, sy + 4, 7, 1);
  }
}

function paintWire(ctx: Paint): void {
  for (let wy = 350; wy <= 510; wy += 35) {
    rect(ctx, P.brown, WIRE.left + 10, wy, 3, 5);
    rect(ctx, P.brown, WIRE.left + 50, wy, 3, 5);
    line(ctx, P.feldgrau, 1, [WIRE.left + 5, wy + 2, WIRE.left + 55, wy + 4]);
    line(ctx, P.feldgrau, 1, [WIRE.left + 5, wy + 4, WIRE.left + 55, wy + 2]);
  }
}

function paintBiomeTexture(ctx: Paint, scene: LandScene, tones: GroundTones, rand: Rand, width: number): void {
  const top = GROUND_TOP + 8;
  const bottom = GROUND_BOTTOM - 6;
  const biome = scene.island === "pacific" ? "desert" : scene.biome;
  switch (biome) {
    case "boreal":
      for (let i = 0; i < 40; i++) oval(ctx, tones.patch, between(rand, 0, width), between(rand, top, bottom), between(rand, 20, 60), between(rand, 3, 7));
      for (let i = 0; i < 26; i++) rect(ctx, tones.accent, between(rand, 0, width), between(rand, top, bottom), between(rand, 4, 10), 1);
      break;
    case "steppe":
      for (let y = top; y < bottom; y += 7) {
        for (let x = between(rand, -20, 0); x < width; x += between(rand, 30, 70)) rect(ctx, tones.patch, x, y, between(rand, 10, 40), 1);
      }
      for (let i = 0; i < 10; i++) {
        const hx = between(rand, 0, width);
        const hy = between(rand, top, bottom);
        oval(ctx, P.brass, hx, hy, 5, 3);
        rect(ctx, P.brown, hx - 4, hy + 2, 8, 1);
      }
      break;
    case "desert":
      for (let i = 0; i < 70; i++) {
        const x = between(rand, 0, width);
        const y = between(rand, top, bottom);
        rect(ctx, tones.patch, x, y, between(rand, 12, 36), 1);
        rect(ctx, tones.accent, x + 3, y + 2, between(rand, 6, 20), 1);
      }
      for (let i = 0; i < 12; i++) oval(ctx, P.brown, between(rand, 0, width), between(rand, top, bottom), between(rand, 2, 4), 2);
      break;
    case "mediterranean":
      for (let i = 0; i < 6; i++) {
        const y = between(rand, top, bottom);
        rect(ctx, P.bone, 0, y, width, 2);
        rect(ctx, P.taupe, 0, y + 2, width, 1);
      }
      for (let i = 0; i < 50; i++) oval(ctx, tones.patch, between(rand, 0, width), between(rand, top, bottom), between(rand, 3, 6), between(rand, 2, 4));
      break;
    case "savanna":
      for (let i = 0; i < 90; i++) {
        const x = between(rand, 0, width);
        const y = between(rand, top, bottom);
        line(ctx, tones.patch, 1, [x, y, x - 1, y - 3]);
        line(ctx, tones.patch, 1, [x + 2, y, x + 3, y - 3]);
      }
      for (let i = 0; i < 8; i++) {
        const x = between(rand, 0, width);
        const y = between(rand, top, bottom);
        poly(ctx, P.brown, [x - 4, y, x, y - 9, x + 4, y]);
      }
      break;
    case "jungle":
      for (let i = 0; i < 60; i++) oval(ctx, pick(rand, [tones.patch, tones.accent, P.olive]), between(rand, 0, width), between(rand, top, bottom), between(rand, 4, 12), between(rand, 2, 6));
      break;
    case "paddy":
      for (let y = top; y < bottom; y += 34) {
        for (let x = 0; x < width; x += 74) {
          if (rand() < 0.6) rect(ctx, tones.patch, x + 3, y + 3, 68, 28);
          rect(ctx, tones.dirt, x, y, 74, 2);
          rect(ctx, tones.dirt, x, y, 2, 34);
        }
      }
      break;
    default:
      for (let gx = 0; gx < width; gx += 64) {
        for (let gy = 120; gy < 520; gy += 48) if (rand() < 0.45) rect(ctx, tones.patch, gx + 4, gy + 4, between(rand, 24, 40), between(rand, 14, 24));
      }
      for (let y = top + 40; y < bottom; y += between(rand, 80, 140)) {
        for (let x = 0; x < width; x += 6) if (rand() < 0.8) oval(ctx, tones.accent, x, y, 4, 2);
      }
  }
}

function paintStreets(ctx: Paint, tones: GroundTones, rand: Rand, width: number, dense: boolean): void {
  const pave = dense ? P.feldgrau : tones.dirt;
  const kerb = dense ? P.taupe : P.brown;
  const avenues = dense ? [229, 367, 505] : [298];
  for (const y of avenues) {
    rect(ctx, pave, 0, y - 5, width, 10);
    rect(ctx, kerb, 0, y - 6, width, 1);
    rect(ctx, kerb, 0, y + 5, width, 1);
    if (dense) for (let x = 0; x < width; x += 22) rect(ctx, P.bone, x, y, 10, 1);
  }
  const streets = dense ? [40, 300, 560, 720, 980, 1240] : [640];
  for (const x of streets) {
    rect(ctx, pave, x - 4, GROUND_TOP + 8, 8, GROUND_BOTTOM - GROUND_TOP - 8);
    rect(ctx, kerb, x - 5, GROUND_TOP + 8, 1, GROUND_BOTTOM - GROUND_TOP - 8);
    rect(ctx, kerb, x + 4, GROUND_TOP + 8, 1, GROUND_BOTTOM - GROUND_TOP - 8);
  }
  if (dense) {
    for (let i = 0; i < 40; i++) rect(ctx, P.bone, between(rand, 0, width), between(rand, 130, 520), 6, 4);
  }
}

function paintRuins(ctx: Paint, culture: Culture, rand: Rand, blocks: number): void {
  const wall = STYLE[culture].walls[0];
  for (let i = 0; i < blocks; i++) {
    const w = between(rand, 30, 60);
    const h = between(rand, 26, 50);
    const x = between(rand, NO_MANS_LAND.left, NO_MANS_LAND.right - w);
    const y = between(rand, 140, 330);
    if (x + w > WIRE.left && x < WIRE.right && y + h > 340) continue;
    rect(ctx, P.taupe, x, y, w, h);
    rect(ctx, wall, x, y, w, 3);
    rect(ctx, wall, x, y, 3, h);
    rect(ctx, wall, x + w - 3, y, 3, h * between(rand, 0.3, 1));
    rect(ctx, wall, x, y + h - 3, w * between(rand, 0.2, 0.8), 3);
    for (let r = 0; r < 8; r++) rect(ctx, pick(rand, [P.brown, P.bone, wall]), x + between(rand, 4, w - 6), y + between(rand, 4, h - 6), 3, 2);
  }
}

function paintRubble(ctx: Paint, rand: Rand, width: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const x = between(rand, 0, width);
    const y = between(rand, 130, 520);
    rect(ctx, pick(rand, [P.brown, P.bone, P.taupe, P.terracotta]), x, y, between(rand, 2, 5), between(rand, 1, 3));
  }
}

function paintFarm(ctx: Paint, scene: LandScene, tones: GroundTones, rand: Rand, width: number): void {
  for (let i = 0; i < 2; i++) {
    const y = between(rand, 160, 500);
    rect(ctx, tones.dirt, 0, y, width, 3);
  }
  const x = between(rand, NO_MANS_LAND.left + 20, WIRE.left - 50);
  const y = between(rand, 150, 280);
  rect(ctx, P.taupe, x, y, 40, 28);
  rect(ctx, STYLE[scene.culture].roof, x, y, 40, 4);
  rect(ctx, STYLE[scene.culture].roof, x, y, 4, 20);
  for (let fx = 0; fx < width; fx += 10) if (rand() < 0.5) rect(ctx, P.brown, fx, 470, 2, 5);
}

/** The battlefield floor: biome texture, the settlement's streets and ruins, trenches and wire. */
export function paintGround(ctx: Paint, scene: LandScene, width: number): void {
  const rand = sceneRandom(scene.seed ^ 0x6e0d);
  const tones = groundTones(scene);
  const urban = scene.settlement === "capital" || scene.settlement === "city";

  rect(ctx, tones.base, 0, GROUND_TOP, width, GROUND_BOTTOM - GROUND_TOP);
  paintBiomeTexture(ctx, scene, tones, rand, width);

  rect(ctx, tones.dirt, 0, GROUND_TOP + 1, width, 6);
  for (let rx = 10; rx < width; rx += 24) rect(ctx, P.charcoal, rx, GROUND_TOP + 2, 8, 4);

  if (urban) {
    paintStreets(ctx, tones, rand, width, true);
    paintRuins(ctx, scene.culture, rand, scene.settlement === "capital" ? 6 : 4);
    paintRubble(ctx, rand, width, scene.settlement === "capital" ? 140 : 90);
  } else if (scene.settlement === "town") {
    paintStreets(ctx, tones, rand, width, false);
    paintRuins(ctx, scene.culture, rand, 2);
    paintRubble(ctx, rand, width, 30);
  } else if (scene.settlement === "village") {
    paintFarm(ctx, scene, tones, rand, width);
  }

  for (let gx = 100; gx < width; gx += 110) {
    for (let y = GROUND_TOP + 8; y < 520; y += 10) rect(ctx, P.taupe, gx, y, 1, 2);
  }
  for (let gy = 150; gy < 520; gy += 90) {
    for (let x = 40; x < width - 40; x += 10) rect(ctx, P.taupe, x, gy, 2, 1);
  }

  paintTrench(ctx, 470, 130, 390, urban);
  paintTrench(ctx, 810, 130, 390, urban);

  const craters = [
    { x: 520, y: 360, r: 16 }, { x: 760, y: 380, r: 14 }, { x: 640, y: 440, r: 20 },
    { x: 580, y: 490, r: 12 }, { x: 700, y: 495, r: 15 }, { x: 490, y: 420, r: 10 }, { x: 790, y: 430, r: 11 },
  ];
  for (const c of craters) paintCrater(ctx, c.x + between(rand, -8, 8), c.y + between(rand, -6, 6), c.r, tones.dirt);

  paintWire(ctx);
  for (const y of [140, 260, 380]) {
    paintSandbags(ctx, 455, y, 18);
    paintSandbags(ctx, 815, y, 18);
  }
}

// ============================================================================
// INLAND EDGE: what lies below the board where a coastal region has its sea
// ============================================================================

function paintRooftops(ctx: Paint, culture: Culture, rand: Rand, width: number, height: number, dense: boolean): void {
  const style = STYLE[culture];
  rect(ctx, P.feldgrau, 0, EDGE_TOP + 14, width, height - EDGE_TOP - 14);
  const blockH = dense ? 46 : 60;
  for (let y = EDGE_TOP + 20; y < height; y += blockH + 10) {
    let x = between(rand, -20, 0);
    while (x < width) {
      const w = between(rand, 50, 120);
      if (dense || rand() < 0.6) {
        rect(ctx, P.charcoal, x + 2, y + 2, w, blockH);
        let rx = x;
        while (rx < x + w - 8) {
          const rw = Math.min(between(rand, 10, 26), x + w - rx);
          const roof = rand() < 0.8 ? style.roof : pick(rand, style.walls);
          rect(ctx, roof, rx, y, rw - 1, blockH);
          rect(ctx, P.charcoal, rx, y + blockH / 2, rw - 1, 1);
          rx += rw;
        }
        if (rand() < 0.15) rect(ctx, P.taupe, x + w * 0.3, y + 6, w * 0.3, blockH * 0.5);
      } else {
        rect(ctx, P.olive, x, y, w, blockH);
        for (let t = 0; t < 4; t++) oval(ctx, P.sage, x + between(rand, 6, w - 6), y + between(rand, 6, blockH - 6), 6, 5);
      }
      x += w + 10;
    }
  }
}

function paintFields(ctx: Paint, scene: LandScene, tones: GroundTones, rand: Rand, width: number, height: number): void {
  const top = EDGE_TOP + 14;
  rect(ctx, tones.base, 0, top, width, height - top);
  switch (scene.biome) {
    case "boreal":
      for (let i = 0; i < 70; i++) {
        const x = between(rand, 0, width);
        const y = between(rand, top + 10, height);
        rect(ctx, P.spruce, x - 4, y - 6, 9, 8);
        rect(ctx, P.cream, x - 2, y - 6, 5, 2);
      }
      break;
    case "desert":
      for (let y = top + 10; y < height; y += 22) paintRidge(ctx, rand, width, y + 14, pick(rand, [P.khaki, P.cream]), 10, 60);
      break;
    case "jungle":
      for (let i = 0; i < 220; i++) oval(ctx, pick(rand, [P.spruce, P.olive, P.sage]), between(rand, 0, width), between(rand, top, height), between(rand, 8, 18), between(rand, 6, 12));
      break;
    case "paddy":
      for (let y = top; y < height; y += 28) {
        for (let x = 0; x < width; x += 60) {
          rect(ctx, rand() < 0.5 ? P.spruce : P.steel, x + 2, y + 2, 56, 24);
          rect(ctx, tones.dirt, x, y, 60, 2);
        }
      }
      break;
    default: {
      const crops = scene.biome === "steppe" ? [P.brass, P.khaki, P.tan] : scene.biome === "savanna" ? [P.khaki, P.tan, P.olive] : scene.biome === "mediterranean" ? [P.olive, P.tan, P.sage] : [P.olive, P.sage, P.brass, P.khaki];
      for (let y = top; y < height; y += 44) {
        let x = between(rand, -30, 0);
        while (x < width) {
          const w = between(rand, 70, 160);
          const crop = pick(rand, crops);
          rect(ctx, crop, x, y, w, 40);
          for (let ry = y + 4; ry < y + 40; ry += 5) rect(ctx, tones.base, x + 2, ry, w - 4, 1);
          rect(ctx, tones.accent, x - 2, y, 3, 44);
          x += w + 3;
        }
        rect(ctx, tones.accent, 0, y + 40, width, 3);
      }
    }
  }
  rect(ctx, tones.dirt, 0, top + 40, width, 5);
}

/** The land strip below the board for regions with no coast. */
export function paintInlandEdge(ctx: Paint, scene: LandScene, width: number, height: number): void {
  const rand = sceneRandom(scene.seed ^ 0x3d6e);
  const tones = groundTones(scene);
  rect(ctx, tones.dirt, 0, EDGE_TOP, width, 14);
  rect(ctx, P.charcoal, 0, EDGE_TOP + 12, width, 2);
  if (scene.settlement === "capital" || scene.settlement === "city" || scene.settlement === "town") {
    paintRooftops(ctx, scene.culture, rand, width, height, scene.settlement !== "town");
  } else {
    paintFields(ctx, scene, tones, rand, width, height);
  }
}

// ============================================================================
// SEA ZONES: water colours and what sits on the horizon
// ============================================================================

export interface SeaLook {
  surface: string;
  mid: string;
  deep: string;
  ticks: [string, string];
  foam: string;
  /** Multiplies swell amplitude and wave speed. */
  swell: number;
  /** Drifting ice floes on the surface. */
  ice: boolean;
  /** Phase offset so neighbouring zones do not move in step. */
  phase: number;
}

const OCEAN_LOOK: Record<Ocean, Omit<SeaLook, "phase" | "swell"> & { swell: number }> = {
  atlantic: { surface: P.steel, mid: P.spruce, deep: P.charcoal, ticks: [P.spruce, P.feldgrau], foam: P.cream, swell: 1.35, ice: false },
  pacific: { surface: P.steel, mid: P.spruce, deep: P.charcoal, ticks: [P.spruce, P.steel], foam: P.cream, swell: 1, ice: false },
  arctic: { surface: P.feldgrau, mid: P.steel, deep: P.charcoal, ticks: [P.bone, P.steel], foam: P.cream, swell: 0.75, ice: true },
  mediterranean: { surface: P.spruce, mid: P.steel, deep: P.charcoal, ticks: [P.sage, P.spruce], foam: P.cream, swell: 0.6, ice: false },
  indian: { surface: P.spruce, mid: P.spruce, deep: P.steel, ticks: [P.sage, P.steel], foam: P.cream, swell: 0.9, ice: false },
};

export function seaLook(scene: SeaScene): SeaLook {
  const rand = sceneRandom(scene.seed ^ 0x5ea);
  const base = OCEAN_LOOK[scene.ocean];
  return { ...base, swell: base.swell * between(rand, 0.85, 1.15), phase: between(rand, 0, Math.PI * 2) };
}

function paintIceberg(ctx: Paint, x: number, w: number, h: number): void {
  const b = HORIZON_Y;
  poly(ctx, P.cream, [x - w / 2, b, x - w / 4, b - h, x + w / 6, b - h * 0.8, x + w / 2, b]);
  poly(ctx, P.bone, [x + w / 6, b - h * 0.8, x + w / 2, b, x + w / 8, b]);
}

function paintFreighter(ctx: Paint, x: number, dir: number): void {
  const b = HORIZON_Y;
  poly(ctx, P.charcoal, [x - 22, b - 2, x - 18 * dir, b - 7, x + 20, b - 7, x + 24, b - 2]);
  rect(ctx, P.charcoal, x - 4, b - 13, 10, 6);
  rect(ctx, P.charcoal, x - 1, b - 18, 3, 5);
  rect(ctx, P.charcoal, x - 16, b - 14, 1, 7);
  rect(ctx, P.charcoal, x + 14, b - 14, 1, 7);
}

function paintCoast(ctx: Paint, scene: SeaScene, rand: Rand, width: number): void {
  if (!scene.coast) return;
  const b = HORIZON_Y;
  const left = rand() < 0.5;
  const span = between(rand, width * 0.25, width * 0.45);
  const x0 = left ? 0 : width - span;
  const h = scene.coast.biome === "desert" ? 10 : scene.coast.biome === "boreal" ? 26 : 18;
  const points = [x0, b];
  for (let x = x0; x <= x0 + span; x += 30) {
    const edge = left ? (x - x0) / span : 1 - (x - x0) / span;
    points.push(x, b - h * (1 - edge * edge) - between(rand, 0, 6));
  }
  points.push(x0 + span, b);
  poly(ctx, scene.coast.biome === "desert" ? P.khaki : P.steel, points);
  for (let x = x0 + 20; x < x0 + span - 20; x += between(rand, 20, 50)) {
    if (rand() < 0.45) {
      paintBuilding(ctx, scene.coast.culture, x, between(rand, 8, 14), between(rand, 8, 14), true, rand);
    } else {
      paintTree(ctx, scene.coast.biome, x, b, between(rand, 8, 14), rand);
    }
  }
  if (scene.ocean !== "arctic" && rand() < 0.7) {
    const lx = left ? x0 + span * 0.8 : x0 + span * 0.2;
    rect(ctx, P.cream, lx - 2, b - 22, 4, 18);
    rect(ctx, P.crimson, lx - 2, b - 18, 4, 3);
    rect(ctx, P.charcoal, lx - 3, b - 25, 6, 3);
  }
}

function paintAtoll(ctx: Paint, x: number, rand: Rand): void {
  const b = HORIZON_Y;
  const half = between(rand, 18, 40);
  if (rand() < 0.4) {
    poly(ctx, P.brown, [x - half, b, x - half * 0.3, b - between(rand, 8, 14), x + half * 0.2, b - between(rand, 8, 12), x + half, b]);
    rect(ctx, P.olive, x - half * 0.4, b - 12, half * 0.6, 3);
  } else {
    rect(ctx, P.brown, x - half * 0.5, b - 5, half, 5);
    rect(ctx, P.olive, x - half * 0.4, b - 8, half * 0.5, 3);
    paintTree(ctx, "desert", x - 4, b - 5, 12, rand);
  }
  rect(ctx, P.tan, x - half - 6, b - 2, half * 2 + 12, 2);
  rect(ctx, P.cream, x - half - 10, b - 1, half * 2 + 20, 1);
}

/** The horizon over a sea zone: ice, a coast, atolls or a passing convoy. */
export function paintSeaHorizon(ctx: Paint, scene: SeaScene, width: number): void {
  const rand = sceneRandom(scene.seed ^ 0x40c);
  paintCoast(ctx, scene, rand, width);
  switch (scene.ocean) {
    case "arctic": {
      const bergs = 3 + Math.floor(rand() * 4);
      for (let i = 0; i < bergs; i++) paintIceberg(ctx, between(rand, 40, width - 40), between(rand, 20, 60), between(rand, 8, 24));
      rect(ctx, P.cream, 0, HORIZON_Y - 2, width, 1);
      break;
    }
    case "pacific":
    case "indian": {
      const atolls = 1 + Math.floor(rand() * 3);
      for (let i = 0; i < atolls; i++) paintAtoll(ctx, between(rand, 80, width - 80), rand);
      if (scene.ocean === "indian" && rand() < 0.7) {
        const dx = between(rand, 200, width - 200);
        poly(ctx, P.brown, [dx - 10, HORIZON_Y - 2, dx - 8, HORIZON_Y - 5, dx + 8, HORIZON_Y - 5, dx + 10, HORIZON_Y - 2]);
        poly(ctx, P.cream, [dx - 1, HORIZON_Y - 22, dx + 9, HORIZON_Y - 6, dx - 1, HORIZON_Y - 6]);
      }
      break;
    }
    case "atlantic": {
      const ships = 2 + Math.floor(rand() * 4);
      const x0 = between(rand, 200, width - 400);
      for (let i = 0; i < ships; i++) paintFreighter(ctx, x0 + i * between(rand, 50, 80), 1);
      ctx.save();
      ctx.globalAlpha = 0.35;
      rect(ctx, P.bone, 0, HORIZON_Y - 10, width, 8);
      ctx.restore();
      break;
    }
    case "mediterranean": {
      if (!scene.coast) paintRidge(ctx, rand, width, HORIZON_Y, P.steel, 12, 80);
      const sails = 1 + Math.floor(rand() * 2);
      for (let i = 0; i < sails; i++) {
        const sx = between(rand, 100, width - 100);
        rect(ctx, P.brown, sx - 6, HORIZON_Y - 4, 12, 3);
        poly(ctx, P.cream, [sx, HORIZON_Y - 18, sx + 7, HORIZON_Y - 5, sx, HORIZON_Y - 5]);
      }
      break;
    }
  }
}
