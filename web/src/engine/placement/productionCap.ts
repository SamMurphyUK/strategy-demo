import type { GameState } from "../model/game_state";
import type { Region } from "../model/region";

/** A minor industrial complex. Global 1940 only. */
export const MINOR_FACTORY_SLOTS = 3;
/** A major industrial complex. Global 1940 only. */
export const MAJOR_FACTORY_SLOTS = 10;

/**
 * Units one factory can build.
 * Quick campaigns use the territory's Industrial Output. Global 1940 uses 3 or 10.
 */
export function factorySlots(state: GameState, region: Region): number {
  if (!region.has_factory || !region.isLandRegion()) {
    return 0;
  }
  if (state.scenarioId === "SCENARIO_GLOBAL_1940") {
    return region.major_factory ? MAJOR_FACTORY_SLOTS : MINOR_FACTORY_SLOTS;
  }
  return Math.max(0, Math.trunc(region.ipc_value));
}

/** Factories this power occupies right now. */
export function liveProductionSlots(state: GameState, factionId: string): number {
  let total = 0;
  for (const region of Object.values(state.regions)) {
    if (region.owner_faction_id !== factionId) {
      continue;
    }
    total += factorySlots(state, region);
  }
  return total;
}

/**
 * Freeze the build cap at the end of mobilize.
 * The next purchase reads this instead of land taken or lost in between.
 */
export function snapshotProduction(state: GameState, factionId = state.current_faction_id): void {
  if (factionId === "") {
    return;
  }
  state.productionSlots[factionId] = liveProductionSlots(state, factionId);
}

/** Units this power may buy. The mobilize snapshot wins once it exists. */
export function purchaseUnitCap(state: GameState, factionId: string): number {
  if (Object.prototype.hasOwnProperty.call(state.productionSlots, factionId)) {
    return Math.max(0, Math.trunc(state.productionSlots[factionId] ?? 0));
  }
  return liveProductionSlots(state, factionId);
}

/** How many of one unit the remaining Industrial Output and build slots can cover. */
export function maxAffordable(cost: number, industrialOutput: number, slots: number): number {
  const price = Math.trunc(cost);
  const money = Math.max(0, Math.trunc(industrialOutput));
  const room = Math.max(0, Math.trunc(slots));
  if (price <= 0) {
    return 0;
  }
  return Math.min(Math.floor(money / price), room);
}
