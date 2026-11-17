// Vector silhouettes per faction, built from the same cues as the battle board's pixel sprites. Pure.
//
// Units are token diameters, centred on the token, y < 0 up. Land and air sit on the disc; sea hulls sit on
// the waterline at y = 0. Every part stays within about 0.46 of the centre.

import {
  type BomberCue,
  type Bridge,
  type CarrierCue,
  type FighterCue,
  type GunCue,
  type Helmet,
  type ShipCue,
  type SubCue,
  type TankCue,
  rosterCues,
  rosterUnit,
} from "../factionRoster";

export interface Pt {
  x: number;
  y: number;
}
export type Shape = Pt[][];

const poly = (...pairs: [number, number][]): Pt[] => pairs.map(([x, y]) => ({ x, y }));
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => poly([x0, y0], [x1, y0], [x1, y1], [x0, y1]);
const scaled = (shape: Shape, k: number): Shape => shape.map((part) => part.map((p) => ({ x: p.x * k, y: p.y * k })));

// ---------------------------------------------------------------
// Land
// ---------------------------------------------------------------

function helmetShape(helmet: Helmet): Pt[][] {
  switch (helmet) {
    case "stahlhelm":
      return [poly([-0.11, -0.27], [-0.1, -0.35], [-0.06, -0.41], [0.03, -0.42], [0.08, -0.37], [0.1, -0.34], [-0.05, -0.34], [-0.07, -0.28])];
    case "ssh40":
      return [
        poly([-0.09, -0.32], [-0.08, -0.39], [-0.04, -0.44], [0.04, -0.44], [0.08, -0.39], [0.09, -0.32]),
        rect(-0.11, -0.32, 0.11, -0.3),
      ];
    case "brodie":
      return [rect(-0.16, -0.355, 0.16, -0.33), poly([-0.07, -0.355], [-0.05, -0.41], [0.05, -0.41], [0.07, -0.355])];
    case "m1":
      return [poly([-0.09, -0.29], [-0.09, -0.37], [-0.05, -0.42], [0.05, -0.42], [0.09, -0.37], [0.09, -0.29])];
    case "havelock":
      return [
        poly([-0.08, -0.34], [-0.06, -0.4], [0.05, -0.4], [0.08, -0.34]),
        poly([-0.1, -0.34], [-0.05, -0.34], [-0.05, -0.22], [-0.13, -0.22]),
      ];
    case "adrian":
    default:
      return [
        poly([-0.11, -0.33], [-0.07, -0.39], [0.06, -0.39], [0.11, -0.33]),
        poly([-0.03, -0.39], [0, -0.44], [0.03, -0.39]),
      ];
  }
}

function infantry(helmet: Helmet): Shape {
  return [
    rect(-0.06, -0.34, 0.05, -0.26),
    ...helmetShape(helmet),
    poly([-0.09, -0.26], [0.07, -0.26], [0.08, -0.02], [-0.08, -0.02]),
    poly([-0.08, -0.02], [-0.14, 0.22], [-0.04, 0.22], [0, 0.06], [0.05, 0.22], [0.15, 0.22], [0.08, -0.02]),
    poly([0.06, -0.16], [0.32, -0.22], [0.34, -0.16], [0.08, -0.1]),
  ];
}

/** A quad of `length` and `thick` from (x, y) along angle `a` (radians, negative is up). */
function barrel(x: number, y: number, length: number, thick: number, a: number): Pt[] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const nx = -s * (thick / 2);
  const ny = c * (thick / 2);
  return poly(
    [x + nx, y + ny],
    [x + c * length + nx, y + s * length + ny],
    [x + c * length - nx, y + s * length - ny],
    [x - nx, y - ny],
  );
}

function artillery(gun: GunCue): Shape {
  const angle = -0.32;
  const length = 0.18 + (gun.barrel / 24) * 0.26;
  const thick = 0.03 + gun.bore * 0.012;
  const parts: Shape = [
    rect(-0.16, -0.02, -0.02, 0.14),
    rect(0.06, -0.02, 0.2, 0.14),
    poly([-0.06, 0.04], [0.22, 0.16], [0.26, 0.1], [0, -0.02]),
    barrel(-0.03, -0.03, length, thick, angle),
  ];
  if (gun.shield > 0) {
    const h = 0.08 + (gun.shield / 13) * 0.16;
    parts.push(rect(0.0, 0.02 - h, 0.05, 0.04));
  }
  if (gun.brake) {
    const ex = -0.03 + Math.cos(angle) * length;
    const ey = -0.03 + Math.sin(angle) * length;
    parts.push(barrel(ex - Math.cos(angle) * 0.05, ey - Math.sin(angle) * 0.05, 0.05, thick + 0.04, angle));
  }
  if (gun.platform) parts.push(rect(-0.24, 0.15, 0.28, 0.19));
  return parts;
}

function tank(cue: TankCue): Shape {
  const half = (cue.length / 40) * 0.42;
  const slope = (cue.glacis / 7) * 0.12;
  const parts: Shape = [
    poly([-half, -0.02], [half - slope, -0.02], [half, 0.08], [half - 0.08, 0.16], [-half + 0.08, 0.16], [-half, 0.06]),
  ];
  if (cue.highTrack) parts.push(poly([-half - 0.02, -0.06], [half + 0.02, -0.06], [half + 0.04, 0.1], [-half - 0.04, 0.1]));
  const tw = (cue.turretW / 18) * 0.3;
  const th = (cue.turretH / 10) * 0.16;
  const cx = (cue.turretX / 40) * 0.84;
  const left = cx - tw / 2;
  const right = cx + tw / 2;
  const top = -0.02 - th;
  parts.push(
    cue.castTurret
      ? poly([left, -0.02], [left, top + 0.04], [left + 0.04, top], [right - 0.06, top], [right, top + 0.06], [right, -0.02])
      : rect(left, top, right, -0.02),
  );
  const length = 0.08 + (cue.barrel / 23) * 0.3;
  const gunY = top + th * 0.45;
  parts.push(rect(right - 0.02, gunY - 0.025, Math.min(0.46, right + length), gunY + 0.025));
  if (cue.brake) parts.push(rect(Math.min(0.46, right + length) - 0.05, gunY - 0.045, Math.min(0.46, right + length), gunY + 0.045));
  return parts;
}

// ---------------------------------------------------------------
// Air, from above
// ---------------------------------------------------------------

function fighter(cue: FighterCue): Shape {
  const noseW = cue.radial ? 0.08 : 0.05;
  const fuselage = cue.radial
    ? poly([-noseW, -0.36], [noseW, -0.36], [0.05, -0.08], [0.04, 0.28], [-0.04, 0.28], [-0.05, -0.08])
    : poly([0, -0.42], [0.05, -0.3], [0.05, -0.08], [0.04, 0.28], [-0.04, 0.28], [-0.05, -0.08], [-0.05, -0.3]);
  let wing: Pt[];
  if (cue.roundTips) {
    // Elliptical planform: a Spitfire's or a Zero's.
    wing = poly(
      [-0.42, -0.02], [-0.38, -0.08], [-0.24, -0.13], [0, -0.15], [0.24, -0.13], [0.38, -0.08], [0.42, -0.02],
      [0.38, 0.03], [0.24, 0.06], [0, 0.04], [-0.24, 0.06], [-0.38, 0.03],
    );
  } else if (cue.fixedGear) {
    // Straight tapered wing of a 1930s monoplane.
    wing = poly([-0.4, -0.06], [0.4, -0.06], [0.4, 0.02], [0, 0.06], [-0.4, 0.02]);
  } else {
    // Clipped square tips: Bf 109, Mustang, Yak.
    wing = poly([-0.41, -0.07], [0, -0.14], [0.41, -0.07], [0.41, 0.0], [0, 0.03], [-0.41, 0.0]);
  }
  const tail = cue.roundTips
    ? poly([-0.13, 0.22], [0.13, 0.22], [0.1, 0.32], [-0.1, 0.32])
    : rect(-0.11, 0.2, 0.11, 0.32);
  const parts: Shape = [fuselage, wing, tail];
  if (cue.scoop) parts.push(rect(-0.035, 0.04, 0.035, 0.16));
  return parts;
}

function bomber(cue: BomberCue): Shape {
  const w = cue.cigar ? 0.11 : 0.08;
  const nose = cue.glazedNose
    ? poly([-0.04, -0.34], [0, -0.36], [0.04, -0.34], [w, -0.26], [w, 0.18], [w - 0.03, 0.22], [-w + 0.03, 0.22], [-w, 0.18], [-w, -0.26])
    : poly([0, -0.36], [w, -0.22], [w, 0.22], [-w, 0.22], [-w, -0.22]);
  const half = 0.46 * cue.span;
  const parts: Shape = [nose, poly([-half, -0.05], [half, -0.05], [half, 0.02], [-half, 0.03])];
  const nacelles = cue.engines === 4 ? [-0.74, -0.37, 0.37, 0.74] : [-0.5, 0.5];
  for (const k of nacelles) {
    const x = k * half;
    parts.push(rect(x - 0.03, -0.14, x + 0.03, 0.08));
  }
  if (cue.twinTail) {
    parts.push(rect(-0.2, 0.22, 0.2, 0.27), rect(-0.21, 0.18, -0.16, 0.34), rect(0.16, 0.18, 0.21, 0.34));
  } else {
    parts.push(rect(-0.16, 0.22, 0.16, 0.28), rect(-0.03, cue.tallFin ? 0.12 : 0.18, 0.03, 0.36));
  }
  return parts;
}

// ---------------------------------------------------------------
// Sea, side on, on the waterline
// ---------------------------------------------------------------

function bridgeShape(bridge: Bridge, x: number): Shape {
  switch (bridge) {
    case "pagoda":
      return [rect(x - 0.07, -0.14, x + 0.05, -0.07), rect(x - 0.05, -0.21, x + 0.03, -0.14), rect(x - 0.03, -0.28, x + 0.01, -0.21)];
    case "tower":
      return [rect(x - 0.06, -0.2, x + 0.04, -0.07), rect(x - 0.04, -0.24, x + 0.02, -0.2)];
    case "tripod":
      return [rect(x - 0.06, -0.13, x + 0.05, -0.07), rect(x - 0.01, -0.25, x + 0.01, -0.13), rect(x - 0.05, -0.24, x + 0.05, -0.22)];
    case "block":
    default:
      return [rect(x - 0.08, -0.17, x + 0.06, -0.07)];
  }
}

function warship(cue: ShipCue, scale: number): Shape {
  const half = 0.44 * scale;
  const parts: Shape = [poly([-half, -0.07], [half - 0.2 * scale, -0.07], [half + 0.02, -0.12], [half - 0.06, 0.06], [-half + 0.06, 0.06])];
  parts.push(...bridgeShape(cue.bridge, 0.02 * scale));
  for (let i = 0; i < cue.funnels; i++) {
    const fx = -0.1 * scale - i * 0.07;
    parts.push(rect(fx - 0.05, -0.17, fx, -0.07));
  }
  const fore = [0.26 * scale, 0.15 * scale];
  const aft = [-0.32 * scale, -0.23 * scale];
  const spots = cue.turrets === 2 ? [fore[0], aft[0]] : cue.turrets === 3 ? [fore[0], fore[1], aft[0]] : [...fore, ...aft];
  for (const x of spots) {
    parts.push(rect(x - 0.035, -0.11, x + 0.035, -0.07));
  }
  return parts;
}

function carrier(cue: CarrierCue): Shape {
  const ix = (cue.islandX / 37) * 0.46;
  const iw = (cue.islandW / 74) * 0.92;
  const ih = 0.06 + (cue.islandH / 14) * 0.08;
  const parts: Shape = [
    poly([-0.46, -0.09], [0.46, -0.09], [0.46, -0.04], [0.36, 0.06], [-0.4, 0.06]),
    rect(ix - iw / 2, -0.09 - ih, ix + iw / 2, -0.09),
    rect(ix - 0.01, -0.09 - ih - 0.06, ix + 0.01, -0.09 - ih),
  ];
  if (cue.funnel) parts.push(rect(ix - iw / 2 - 0.04, -0.09 - ih * 0.8, ix - iw / 2, -0.09));
  return parts;
}

function submarine(cue: SubCue): Shape {
  const half = 0.44 * Math.min(1, 0.6 + (cue.length / 56) * 0.4);
  const th = 0.05 + (cue.tower / 12) * 0.06;
  const parts: Shape = [
    poly([-half, 0], [-half + 0.12, -0.07], [half - 0.14, -0.07], [half, -0.01], [half - 0.14, 0.07], [-half + 0.12, 0.07]),
    poly([-0.08, -0.07], [-0.06, -0.07 - th], [0.08, -0.07 - th], [0.1, -0.07]),
  ];
  if (cue.hangar) parts.push(rect(0.08, -0.13, 0.28, -0.07));
  if (cue.deckGun) {
    const gx = cue.hangar ? -0.2 : 0.16;
    parts.push(rect(gx, -0.1, gx + 0.03, -0.07), rect(gx + 0.02, -0.105, gx + 0.09, -0.09));
  }
  return parts;
}

/**
 * This faction's silhouette for a rules unit, or null when the unit has no roster entry (AA guns, mech
 * infantry, transports) and the caller keeps its shared drawing.
 */
export function factionSilhouette(unitTypeId: string, factionId: string | null | undefined): Shape | null {
  const unit = rosterUnit(unitTypeId);
  if (unit == null) return null;
  const cues = rosterCues(factionId);
  switch (unit) {
    case "infantry":
      return infantry(cues.helmet);
    case "artillery":
      return artillery(cues.gun);
    case "tank":
      return tank(cues.tank);
    case "fighter":
      return fighter(cues.fighter);
    case "bomber":
      // The tactical bomber is the same airframe family, drawn smaller and twin-engined so it reads apart.
      return unitTypeId.trim().toLowerCase() === "tactical_bomber"
        ? scaled(bomber({ ...cues.bomber, engines: 2 }), 0.82)
        : bomber(cues.bomber);
    case "submarine":
      return submarine(cues.sub);
    case "destroyer":
      return warship(cues.destroyer, 0.9);
    case "cruiser":
      return warship(cues.cruiser, 0.97);
    case "battleship":
      return warship(cues.battleship, 1);
    case "carrier":
      return carrier(cues.carrier);
    case "transport":
      return null;
  }
}
