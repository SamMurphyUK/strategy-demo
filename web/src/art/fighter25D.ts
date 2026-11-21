/**
 * 2.5D wing foreshortening and banking for ger_fighter_seed1_25D.
 * Driven from the battle preview rAF loop (no React state).
 */

export const FIGHTER_25D_ID = "ger_fighter_seed1_25D";
export const FIGHTER_25D_VECTOR_BASE = `/assets/units/vector/frames/${FIGHTER_25D_ID}`;
export const FIGHTER_25D_LAYER_BASE = `${FIGHTER_25D_VECTOR_BASE}`;

export const FIGHTER_25D_WING_ROOT = { x: 93, y: 77 } as const;

export type Fighter25DRole = "shadow" | "farWing" | "fuselage" | "prop" | "nearWing";

/** Map 25D art roles onto the existing SVG ladder slots. */
export const FIGHTER_25D_ROLE_SLOT: Record<Exclude<Fighter25DRole, "shadow">, "tracks" | "torso" | "head" | "weapon"> = {
  farWing: "tracks",
  fuselage: "torso",
  prop: "head",
  nearWing: "weapon",
};

export interface Fighter25DAffine {
  scaleX: number;
  scaleY: number;
  skewXDeg: number;
  rotateDeg: number;
  dx: number;
  dy: number;
  opacity: number;
}

export interface Fighter25DPose {
  theta: number;
  altitude: number;
  farWing: Fighter25DAffine;
  fuselage: Fighter25DAffine;
  prop: Fighter25DAffine;
  nearWing: Fighter25DAffine;
  shadow: Fighter25DAffine & { groundY: number };
}

const IDENTITY: Fighter25DAffine = {
  scaleX: 1,
  scaleY: 1,
  skewXDeg: 0,
  rotateDeg: 0,
  dx: 0,
  dy: 0,
  opacity: 1,
};

export function isFighter25DId(unitId: string | null | undefined): boolean {
  return typeof unitId === "string" && /_25D$/i.test(unitId);
}

/**
 * Smooth bank angle in radians. Idle holds a level foreshorten bias;
 * move / All oscillates so the near wing opens toward the camera.
 */
export function fighter25DTheta(elapsedSec: number, mode: "idle" | "moving" | "firing" | "all"): number {
  if (mode === "idle") {
    return 0;
  }
  // ~0.35 Hz bank while manoeuvring / in the All loop.
  return Math.sin(elapsedSec * Math.PI * 0.7) * 0.85;
}

export function fighter25DAltitude(elapsedSec: number, mode: "idle" | "moving" | "firing" | "all"): number {
  if (mode === "idle") {
    return 0.35;
  }
  return 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(elapsedSec * Math.PI * 0.45));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function fighter25DPose(theta: number, altitude: number): Fighter25DPose {
  // theta 0 = level cruise foreshorten; +1 banks near wing toward camera.
  const bank = Math.max(-1, Math.min(1, theta));
  const open = Math.max(0, bank);

  const farScaleY = lerp(0.32, 0.15, open);
  const nearScaleY = lerp(0.32, 1.05, open);
  const farSkew = lerp(-12, -4, open);
  const nearSkew = lerp(-12, -3, open);
  const farDy = lerp(0, -1, open);
  const nearDy = lerp(0, 2, open);
  const fuselageRot = bank * 4;
  const shadowScale = lerp(1, 0.72, Math.max(0, Math.min(1, altitude)));

  return {
    theta: bank,
    altitude,
    farWing: {
      ...IDENTITY,
      scaleY: farScaleY,
      skewXDeg: farSkew,
      dy: farDy,
      dx: open * -1,
    },
    fuselage: {
      ...IDENTITY,
      rotateDeg: fuselageRot,
    },
    prop: { ...IDENTITY },
    nearWing: {
      ...IDENTITY,
      scaleY: nearScaleY,
      skewXDeg: nearSkew,
      dy: nearDy,
    },
    shadow: {
      ...IDENTITY,
      scaleX: shadowScale,
      scaleY: 0.25 * shadowScale,
      skewXDeg: 25,
      opacity: 0.35,
      groundY: 18 + altitude * 10,
      dy: 0,
      dx: 8,
    },
  };
}

export function fighter25DLayerUrl(role: Fighter25DRole): string {
  return `${FIGHTER_25D_LAYER_BASE}/${role === "prop" ? "prop" : role}.svg`;
}

export const FIGHTER_25D_Z_ORDER: readonly Fighter25DRole[] = ["shadow", "farWing", "fuselage", "prop", "nearWing"];
