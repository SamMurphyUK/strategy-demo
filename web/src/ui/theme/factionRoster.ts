// Which historical machine each faction fields for a rules unit, and the shape cues that tell them apart.
// Pure. Rules ids and stats are untouched: this only decides the drawing and the name on the tooltip.
//
// The battle board's pixel sprites and the map's vector silhouettes both read these cues, so a Tiger
// looks like a Tiger at every size.

import { resolveFaction } from "./factionPalette";

export type RosterKey = "GER" | "USSR" | "UK" | "US" | "JAP" | "MINOR";

export type RosterUnit =
  | "infantry"
  | "artillery"
  | "tank"
  | "fighter"
  | "bomber"
  | "submarine"
  | "destroyer"
  | "cruiser"
  | "carrier"
  | "battleship"
  | "transport";

export type Helmet = "stahlhelm" | "ssh40" | "brodie" | "m1" | "havelock" | "adrian";

export interface GunCue {
  /** Barrel length in battle pixels. */
  barrel: number;
  bore: number;
  brake: boolean;
  /** Shield height in battle pixels. 0 is no shield. */
  shield: number;
  /** A round firing platform under the wheel, as on the 25-pounder. */
  platform: boolean;
}

export interface TankCue {
  length: number;
  turretW: number;
  turretH: number;
  /** Turret centre, forward of the hull centre. */
  turretX: number;
  barrel: number;
  brake: boolean;
  /** How far the glacis slopes back, in pixels. 0 is a slab front. */
  glacis: number;
  wheels: number;
  wheelR: number;
  /** Tracks run up over the hull sides, as on the Churchill. */
  highTrack: boolean;
  /** A rounded cast turret rather than a welded box. */
  castTurret: boolean;
}

export interface FighterCue {
  radial: boolean;
  roundTips: boolean;
  /** Belly radiator scoop. */
  scoop: boolean;
  fixedGear: boolean;
  canopy: number;
}

export interface BomberCue {
  engines: 2 | 4;
  twinTail: boolean;
  glazedNose: boolean;
  tallFin: boolean;
  /** Wingspan against a Lancaster's. Only the top-down map silhouette shows it. */
  span: number;
  /** The Betty's fat cigar fuselage. */
  cigar: boolean;
}

export interface SubCue {
  length: number;
  tower: number;
  /** The I-400's aircraft hangar forward of the tower. */
  hangar: boolean;
  deckGun: boolean;
}

export type Bridge = "pagoda" | "tower" | "tripod" | "block";

export interface ShipCue {
  funnels: 1 | 2 | 3;
  bridge: Bridge;
  /** Main turrets. Two forward, then aft. */
  turrets: 2 | 3 | 4;
}

export interface CarrierCue {
  islandW: number;
  islandH: number;
  /** Island centre along the deck, forward positive. */
  islandX: number;
  /** A funnel trunked into the island. Shokaku vents down the side instead. */
  funnel: boolean;
}

export interface RosterCues {
  helmet: Helmet;
  gun: GunCue;
  tank: TankCue;
  fighter: FighterCue;
  bomber: BomberCue;
  sub: SubCue;
  destroyer: ShipCue;
  cruiser: ShipCue;
  battleship: ShipCue;
  carrier: CarrierCue;
}

export const ROSTER_NAMES: Record<RosterKey, Record<RosterUnit, string>> = {
  GER: {
    infantry: "Stahlhelm infantry",
    artillery: "10.5cm leFH 18",
    tank: "Panzer IV / Tiger I",
    fighter: "Bf 109",
    bomber: "He 111",
    submarine: "Type VII U-Boat",
    destroyer: "Narvik destroyer",
    cruiser: "Hipper cruiser",
    carrier: "Graf Zeppelin carrier",
    battleship: "Bismarck battleship",
    transport: "Hansa freighter",
  },
  USSR: {
    infantry: "Ssh-40 infantry",
    artillery: "ZiS-3 gun",
    tank: "T-34/85",
    fighter: "Yak-3",
    bomber: "Pe-2/Il-4",
    submarine: "Shchuka sub",
    destroyer: "Gnevny destroyer",
    cruiser: "Kirov cruiser",
    carrier: "Project 72 carrier",
    battleship: "Sovetsky Soyuz battleship",
    transport: "Dekabrist freighter",
  },
  UK: {
    infantry: "Brodie-helmet infantry",
    artillery: "QF 25-pounder",
    tank: "Churchill/Cromwell",
    fighter: "Spitfire",
    bomber: "Lancaster",
    submarine: "T-class sub",
    destroyer: "Tribal destroyer",
    cruiser: "County cruiser",
    carrier: "Illustrious carrier",
    battleship: "King George V battleship",
    transport: "Empire freighter",
  },
  US: {
    infantry: "M1-helmet infantry",
    artillery: "M2A1 105mm",
    tank: "M4 Sherman",
    fighter: "P-51 Mustang",
    bomber: "B-17",
    submarine: "Gato sub",
    destroyer: "Fletcher destroyer",
    cruiser: "Baltimore cruiser",
    carrier: "Essex carrier",
    battleship: "Iowa battleship",
    transport: "Liberty ship",
  },
  JAP: {
    infantry: "Type 90 havelock infantry",
    artillery: "Type 91 105mm",
    tank: "Type 97 Chi-Ha",
    fighter: "A6M Zero",
    bomber: "G4M Betty",
    submarine: "I-400 sub",
    destroyer: "Kagero destroyer",
    cruiser: "Takao cruiser",
    carrier: "Shokaku carrier",
    battleship: "Yamato battleship",
    transport: "Type 2 standard freighter",
  },
  MINOR: {
    infantry: "Adrian-helmet infantry",
    artillery: "Škoda 100mm howitzer",
    tank: "LT vz. 38",
    fighter: "Fokker D.XXI",
    bomber: "Bristol Blenheim",
    submarine: "Vesikko coastal sub",
    destroyer: "Torpedo boat",
    cruiser: "Light cruiser",
    carrier: "Seaplane tender",
    battleship: "Väinämöinen coastal battleship",
    transport: "Coastal freighter",
  },
};

export const ROSTER_CUES: Record<RosterKey, RosterCues> = {
  GER: {
    helmet: "stahlhelm",
    gun: { barrel: 15, bore: 5, brake: false, shield: 13, platform: false },
    tank: { length: 36, turretW: 18, turretH: 9, turretX: 0, barrel: 21, brake: true, glacis: 0, wheels: 8, wheelR: 3.4, highTrack: false, castTurret: false },
    fighter: { radial: false, roundTips: false, scoop: false, fixedGear: false, canopy: 5 },
    bomber: { engines: 2, twinTail: false, glazedNose: true, tallFin: false, span: 0.88, cigar: false },
    sub: { length: 42, tower: 10, hangar: false, deckGun: true },
    destroyer: { funnels: 2, bridge: "tower", turrets: 3 },
    cruiser: { funnels: 1, bridge: "tower", turrets: 4 },
    battleship: { funnels: 1, bridge: "tower", turrets: 4 },
    carrier: { islandW: 15, islandH: 11, islandX: 6, funnel: true },
  },
  USSR: {
    helmet: "ssh40",
    gun: { barrel: 24, bore: 3, brake: true, shield: 8, platform: false },
    tank: { length: 34, turretW: 16, turretH: 8, turretX: 2, barrel: 23, brake: false, glacis: 7, wheels: 5, wheelR: 3.8, highTrack: false, castTurret: true },
    fighter: { radial: false, roundTips: true, scoop: true, fixedGear: false, canopy: 4 },
    bomber: { engines: 2, twinTail: true, glazedNose: true, tallFin: false, span: 0.74, cigar: false },
    sub: { length: 38, tower: 9, hangar: false, deckGun: true },
    destroyer: { funnels: 2, bridge: "tripod", turrets: 2 },
    cruiser: { funnels: 2, bridge: "tripod", turrets: 3 },
    battleship: { funnels: 1, bridge: "tower", turrets: 3 },
    carrier: { islandW: 13, islandH: 12, islandX: 8, funnel: true },
  },
  UK: {
    helmet: "brodie",
    gun: { barrel: 16, bore: 4, brake: true, shield: 9, platform: true },
    tank: { length: 40, turretW: 13, turretH: 8, turretX: -2, barrel: 15, brake: false, glacis: 0, wheels: 9, wheelR: 2.2, highTrack: true, castTurret: false },
    fighter: { radial: false, roundTips: true, scoop: false, fixedGear: false, canopy: 4 },
    bomber: { engines: 4, twinTail: true, glazedNose: false, tallFin: false, span: 1, cigar: false },
    sub: { length: 44, tower: 10, hangar: false, deckGun: true },
    destroyer: { funnels: 2, bridge: "block", turrets: 3 },
    cruiser: { funnels: 3, bridge: "block", turrets: 4 },
    battleship: { funnels: 2, bridge: "block", turrets: 3 },
    carrier: { islandW: 12, islandH: 12, islandX: 4, funnel: true },
  },
  US: {
    helmet: "m1",
    gun: { barrel: 22, bore: 4, brake: false, shield: 8, platform: false },
    tank: { length: 32, turretW: 15, turretH: 10, turretX: 2, barrel: 17, brake: false, glacis: 5, wheels: 6, wheelR: 3, highTrack: false, castTurret: true },
    fighter: { radial: false, roundTips: false, scoop: true, fixedGear: false, canopy: 5 },
    bomber: { engines: 4, twinTail: false, glazedNose: true, tallFin: true, span: 0.98, cigar: false },
    sub: { length: 50, tower: 9, hangar: false, deckGun: true },
    destroyer: { funnels: 2, bridge: "block", turrets: 2 },
    cruiser: { funnels: 2, bridge: "tower", turrets: 3 },
    battleship: { funnels: 2, bridge: "tower", turrets: 3 },
    carrier: { islandW: 17, islandH: 14, islandX: 6, funnel: true },
  },
  JAP: {
    helmet: "havelock",
    gun: { barrel: 18, bore: 4, brake: false, shield: 10, platform: false },
    tank: { length: 28, turretW: 10, turretH: 7, turretX: 3, barrel: 10, brake: false, glacis: 2, wheels: 6, wheelR: 2.4, highTrack: false, castTurret: false },
    fighter: { radial: true, roundTips: true, scoop: false, fixedGear: false, canopy: 7 },
    bomber: { engines: 2, twinTail: false, glazedNose: true, tallFin: false, span: 0.95, cigar: true },
    sub: { length: 56, tower: 12, hangar: true, deckGun: true },
    destroyer: { funnels: 2, bridge: "tripod", turrets: 3 },
    cruiser: { funnels: 2, bridge: "pagoda", turrets: 4 },
    battleship: { funnels: 1, bridge: "pagoda", turrets: 3 },
    carrier: { islandW: 8, islandH: 8, islandX: 14, funnel: false },
  },
  MINOR: {
    helmet: "adrian",
    gun: { barrel: 14, bore: 4, brake: false, shield: 11, platform: false },
    tank: { length: 26, turretW: 11, turretH: 7, turretX: 0, barrel: 9, brake: false, glacis: 1, wheels: 4, wheelR: 3.6, highTrack: false, castTurret: false },
    fighter: { radial: true, roundTips: false, scoop: false, fixedGear: true, canopy: 4 },
    bomber: { engines: 2, twinTail: false, glazedNose: true, tallFin: false, span: 0.68, cigar: false },
    sub: { length: 32, tower: 8, hangar: false, deckGun: false },
    destroyer: { funnels: 1, bridge: "block", turrets: 2 },
    cruiser: { funnels: 2, bridge: "block", turrets: 2 },
    battleship: { funnels: 1, bridge: "tower", turrets: 2 },
    carrier: { islandW: 10, islandH: 9, islandX: 8, funnel: true },
  },
};

/** The five powers keep their own roster. Italy, China, ANZAC, France, and neutrals field the fallback set. */
export function rosterKey(factionId: string | null | undefined): RosterKey {
  const key = resolveFaction(factionId);
  if (key === "US" || key === "UK" || key === "GER" || key === "JAP" || key === "USSR") return key;
  return "MINOR";
}

/** The roster slot for a rules unit id, or null for pieces with no historical counterpart (AA guns, mech infantry). */
export function rosterUnit(unitTypeId: string): RosterUnit | null {
  switch (unitTypeId.trim().toLowerCase()) {
    case "infantry":
      return "infantry";
    case "artillery":
      return "artillery";
    case "tank":
    case "armor":
      return "tank";
    case "fighter":
      return "fighter";
    case "bomber":
    case "tactical_bomber":
    case "strategic_bomber":
      return "bomber";
    case "submarine":
    case "sub":
      return "submarine";
    case "destroyer":
      return "destroyer";
    case "cruiser":
      return "cruiser";
    case "carrier":
      return "carrier";
    case "battleship":
      return "battleship";
    case "transport":
      return "transport";
    default:
      return null;
  }
}

/** The historical name for this faction's piece, or null when the unit has no roster entry. */
export function rosterName(unitTypeId: string, factionId: string | null | undefined): string | null {
  const unit = rosterUnit(unitTypeId);
  return unit ? ROSTER_NAMES[rosterKey(factionId)][unit] : null;
}

export function rosterCues(factionId: string | null | undefined): RosterCues {
  return ROSTER_CUES[rosterKey(factionId)];
}
