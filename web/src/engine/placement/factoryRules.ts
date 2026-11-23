import type { GameState } from "../model/game_state";
import type { Region } from "../model/region";

/** Industrial complexes. Quick pays two-thirds of the Global 1940 price, rounded. */
export const FACTORY_KINDS = ["minor_factory", "major_factory", "factory_upgrade", "airbase", "naval_base"] as const;
export type FactoryKind = (typeof FACTORY_KINDS)[number];

const GLOBAL_PRICE: Record<FactoryKind, number> = {
  minor_factory: 12,
  major_factory: 30,
  factory_upgrade: 20,
  airbase: 15,
  naval_base: 15,
};

export function isFactoryKind(unitTypeId: string): unitTypeId is FactoryKind {
  return (
    unitTypeId === "minor_factory" ||
    unitTypeId === "major_factory" ||
    unitTypeId === "factory_upgrade" ||
    unitTypeId === "airbase" ||
    unitTypeId === "naval_base"
  );
}

export function factoryPrice(state: GameState, kind: FactoryKind): number {
  const base = GLOBAL_PRICE[kind];
  if (state.scenarioId === "SCENARIO_GLOBAL_1940") {
    return base;
  }
  return Math.round((base * 2) / 3);
}

export function factoryLabel(kind: FactoryKind): string {
  if (kind === "minor_factory") {
    return "Forward depot";
  }
  if (kind === "major_factory") {
    return "Major complex";
  }
  if (kind === "airbase") {
    return "Airbase";
  }
  if (kind === "naval_base") {
    return "Naval base";
  }
  return "Major upgrade";
}

function startedHere(region: Region, factionId: string): boolean {
  const origin = region.original_owner_id !== "" ? region.original_owner_id : region.owner_faction_id;
  return origin === factionId;
}

function heldSinceTurnStart(state: GameState, region: Region, factionId: string): boolean {
  return region.owner_faction_id === factionId && state.territories_captured_this_turn[region.id] !== true;
}

function hasCoast(state: GameState, region: Region): boolean {
  return state.getAdjacentRegions(region.id).some((id) => state.regions[id]?.isSeaRegion() === true);
}

/** True when this territory can take that complex right now. */
export function factorySiteFits(state: GameState, factionId: string, kind: FactoryKind, region: Region): boolean {
  if (!region.isLandRegion() || !heldSinceTurnStart(state, region, factionId)) {
    return false;
  }
  if (kind === "airbase") {
    return !region.airbase;
  }
  if (kind === "naval_base") {
    return !region.harbor && hasCoast(state, region);
  }
  const value = Math.trunc(region.ipc_value);
  if (kind === "factory_upgrade") {
    return region.has_factory && !region.major_factory && value >= 3 && startedHere(region, factionId);
  }
  if (region.has_factory) {
    return false;
  }
  if (kind === "minor_factory") {
    return value >= 2;
  }
  return value >= 3 && startedHere(region, factionId);
}

export function factorySites(state: GameState, factionId: string, kind: FactoryKind): string[] {
  const sites: string[] = [];
  for (const region of Object.values(state.regions)) {
    if (factorySiteFits(state, factionId, kind, region)) {
      sites.push(region.id);
    }
  }
  return sites;
}

/** Why the shop row is grey. Empty when at least one territory can take it. */
export function factoryBlockReason(state: GameState, factionId: string, kind: FactoryKind): string | null {
  if (factorySites(state, factionId, kind).length > 0) {
    return null;
  }
  if (kind === "minor_factory") {
    return "No territory worth 2 Industrial Output or more, held since the start of the turn, is free of a complex.";
  }
  if (kind === "major_factory") {
    return "A major complex needs a territory you started with, worth 3 Industrial Output, with no complex on it.";
  }
  if (kind === "airbase") {
    return "Every territory you have held since the start of the turn already has an airbase.";
  }
  if (kind === "naval_base") {
    return "No coastal territory you have held since the start of the turn is without a naval base.";
  }
  return "No minor complex you started with sits on a territory worth 3 Industrial Output.";
}

/**
 * How many more of this complex fit, given complexes already chosen.
 * A new major uses a territory that could also have taken a minor.
 */
export function factoryRoom(state: GameState, factionId: string, kind: FactoryKind, taken: Record<string, number>): number {
  if (kind === "airbase" || kind === "naval_base") {
    return Math.max(0, factorySites(state, factionId, kind).length - Math.max(0, Math.trunc(taken[kind] ?? 0)));
  }
  const minorSites = factorySites(state, factionId, "minor_factory").length;
  const majorSites = factorySites(state, factionId, "major_factory").length;
  const upgradeSites = factorySites(state, factionId, "factory_upgrade").length;
  const minors = Math.max(0, Math.trunc(taken.minor_factory ?? 0));
  const majors = Math.max(0, Math.trunc(taken.major_factory ?? 0));
  const upgrades = Math.max(0, Math.trunc(taken.factory_upgrade ?? 0));
  const shared = Math.max(0, minorSites - minors - majors);
  if (kind === "factory_upgrade") {
    return Math.max(0, upgradeSites - upgrades);
  }
  if (kind === "minor_factory") {
    return shared;
  }
  return Math.max(0, Math.min(majorSites - majors, shared));
}

/** Place one purchased complex. A string is the reason it cannot go there. */
export function applyFactory(state: GameState, factionId: string, kind: FactoryKind, regionId: string): string | null {
  const region = state.regions[regionId];
  if (region == null || !factorySiteFits(state, factionId, kind, region)) {
    return factoryBlockReason(state, factionId, kind) ?? "That territory cannot take this complex.";
  }
  if (kind === "airbase") {
    region.airbase = true;
    return null;
  }
  if (kind === "naval_base") {
    region.harbor = true;
    return null;
  }
  region.has_factory = true;
  region.major_factory = kind !== "minor_factory";
  return null;
}
