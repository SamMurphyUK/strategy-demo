// Sprite textures for the battle stage. Every texture is NEAREST filtered and NoColorSpace, so a sprite's pixels reach the
// screen as the exact fading-16 hex values they were drawn in.
//
//   units    baked from the battle screen's own unit painter (unitRenderer.ts) onto a canvas, feet on a fixed point,
//            so the stage shows the same figures the 2D board does. Painted facing right; the stage mirrors them.
//   scatter  the John Nash 20mm sprites (assets/terrain/scatter), pulled onto the fading-16 strip by the active skin.
import * as THREE from "three";
import type { CombatUnit } from "../../battle/combatTypes";
import { drawProceduralUnit } from "../../battle/unitRenderer";
import { factionPalette } from "../../theme/factionPalette";
import { harmonizePixels, type BattleSkin, type ScatterSet } from "../skins/battleSkin";

/** Pixels in one stage unit. A tank is about 1.7 units long. */
export const PX_PER_UNIT = 62;
const SHEET_W = 220;
const SHEET_H = 170;
/** Where the feet stand on a unit's sheet. */
const FEET_X = SHEET_W / 2;
const FEET_Y = SHEET_H - 30;

/** The sheet of a unit as a quad: its size in stage units, and the offset that puts the feet at the quad's origin. */
export interface SpriteSheet {
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Quad centre from the feet, in stage units. */
  centerX: number;
  centerZ: number;
  /** Where the sprite's own feet are across its width, 0 to 1. */
  feet: number;
}

function nearestTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.premultiplyAlpha = false;
  texture.needsUpdate = true;
  return texture;
}

function stubUnit(type: string, side: "attacker" | "defender"): CombatUnit {
  return {
    uid: `bake-${type}`,
    type,
    side,
    currentHp: 1,
    maxHp: 1,
    effectiveRank: 1,
    hasSynergyBonus: false,
    hasFiredThisRound: false,
    isPendingCasualty: false,
    isDestroyed: false,
    status: "alive",
    animRecoil: 0,
    animBobOffset: 0,
    animAnticipation: 0,
    animAimTilt: 0,
    animRevEngine: 0,
    damageSmokeParticles: false,
    colIndex: 0,
    rowIndex: 0,
  } as unknown as CombatUnit;
}

/** Paints one unit onto its sheet. Done again while the battle screen's shelf pictures finish loading. */
export function paintUnit(sheet: SpriteSheet, type: string, factionId: string, time = 0): void {
  const ctx = sheet.canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return;
  }
  ctx.clearRect(0, 0, SHEET_W, SHEET_H);
  ctx.imageSmoothingEnabled = false;
  try {
    drawProceduralUnit(ctx, stubUnit(type, "attacker"), FEET_X, FEET_Y, 1, time, factionPalette(factionId).primary, null, false, 1, "normandy", factionId);
  } catch {
    // A figure the painter cannot draw stays blank: the stage shows its contact shadow and nothing else.
  }
  sheet.texture.needsUpdate = true;
}

export function createUnitSheet(type: string, factionId: string): SpriteSheet {
  const canvas = document.createElement("canvas");
  canvas.width = SHEET_W;
  canvas.height = SHEET_H;
  const sheet: SpriteSheet = {
    texture: nearestTexture(canvas),
    canvas,
    width: SHEET_W / PX_PER_UNIT,
    height: SHEET_H / PX_PER_UNIT,
    centerX: (SHEET_W / 2 - FEET_X) / PX_PER_UNIT,
    centerZ: (FEET_Y - SHEET_H / 2) / PX_PER_UNIT,
    feet: FEET_X / SHEET_W,
  };
  paintUnit(sheet, type, factionId);
  return sheet;
}

// --- Scatter -------------------------------------------------------------------------------------------------------

interface ManifestEntry {
  file: string;
  size_px: [number, number];
  anchor_bottom_center: [number, number];
  world_size_units: [number, number, number];
}

// The folder is not tracked, so it is read with a glob: a checkout without it builds, and the stage draws no scatter.
const manifests = import.meta.glob("../../../../assets/terrain/scatter_manifest.json", { import: "default", eager: true }) as Record<string, { sprites: Record<string, ManifestEntry> }>;
const manifest: Record<string, ManifestEntry> = Object.values(manifests)[0]?.sprites ?? {};

const pngUrls = import.meta.glob("../../../../assets/terrain/scatter/*.png", { query: "?url", import: "default", eager: true }) as Record<string, string>;

function urlOfScatter(name: string): string | null {
  const hit = Object.keys(pngUrls).find((path) => path.endsWith(`/${name}.png`));
  return hit ? pngUrls[hit] : null;
}

/** One hull length in the Nash manifest is 135 px, and a tank hull is 1.7 stage units long. */
const SCATTER_UNIT = 1.0;
const MANIFEST_PX_PER_UNIT = 135;

export interface ScatterSprite {
  texture: THREE.CanvasTexture;
  /** Size in stage units, and the anchor's offset across the sprite (0 to 1) so its foot stands at the origin. */
  width: number;
  height: number;
  anchorX: number;
}

const scatterCache = new Map<string, Promise<ScatterSprite | null>>();

/** A scatter sprite, pulled onto the skin's palette. Null when the art is missing (the folder is not in every checkout). */
export function loadScatter(skin: BattleSkin, set: ScatterSet, variant: number): Promise<ScatterSprite | null> {
  const name = `${set}_v${variant}`;
  const key = `${skin.id}|${name}`;
  const known = scatterCache.get(key);
  if (known) {
    return known;
  }
  const entry = manifest[name];
  const url = urlOfScatter(name);
  const pending =
    entry && url
      ? new Promise<ScatterSprite | null>((resolve) => {
          const image = new Image();
          image.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (!ctx) {
              resolve(null);
              return;
            }
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(image, 0, 0);
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
            harmonizePixels(pixels.data, skin.grade.scatterPull, skin.grade.groundLumaCeiling);
            ctx.putImageData(pixels, 0, 0);
            resolve({
              texture: nearestTexture(canvas),
              width: (image.width / MANIFEST_PX_PER_UNIT) * SCATTER_UNIT,
              height: (image.height / MANIFEST_PX_PER_UNIT) * SCATTER_UNIT,
              anchorX: entry.anchor_bottom_center[0] / image.width,
            });
          };
          image.onerror = () => resolve(null);
          image.src = url;
        })
      : Promise.resolve(null);
  scatterCache.set(key, pending);
  return pending;
}

/** Whether the scatter art is in this checkout at all. */
export function haveScatterArt(): boolean {
  return Object.keys(pngUrls).length > 0;
}

/** Frees every scatter texture. Called when the stage unmounts. */
export function disposeScatter(): void {
  for (const pending of scatterCache.values()) {
    void pending.then((sprite) => sprite?.texture.dispose());
  }
  scatterCache.clear();
}
