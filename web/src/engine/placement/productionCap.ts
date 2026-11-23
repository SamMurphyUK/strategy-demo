import type { GameState } from "../model/game_state";
import type { Region } from "../model/region";

/** A minor industrial complex. Global 1940 only. */
export const MINOR_FACTORY_SLOTS = 3;
/** A major industrial complex. Global 1940 only. */
export const MAJOR_FACTORY_SLOTS = 10;

export type CapacityMode = "TERRITORY_IO" | "FACILITY_TIER";

export interface TurnBuildCapacity {
  maxUnits: number;
  breakdown: { territoryId: string; slots: number }[];
}

export function capacityMode(state: GameState): CapacityMode {
  return state.scenarioId === "SCENARIO_GLOBAL_1940" ? "FACILITY_TIER" : "TERRITORY_IO";
}

/** Units one factory can still build after damage. */
export function factorySlots(state: GameState, region: Region): number {
  if (!region.has_factory || !region.isLandRegion()) {
    return 0;
  }
  const damage = Math.max(0, Math.trunc(state.repairTokens[region.id] ?? 0));
  if (capacityMode(state) === "FACILITY_TIER") {
    const tier = region.major_factory ? MAJOR_FACTORY_SLOTS : MINOR_FACTORY_SLOTS;
    return Math.max(0, tier - damage);
  }
  const output = region.base_output > 0 ? region.base_output : region.ipc_value;
  return Math.max(0, Math.trunc(output) - damage);
}

/** Factories this power occupies right now, with the slot each one still has. */
export function liveBuildCapacity(state: GameState, factionId: string): TurnBuildCapacity {
  const breakdown: { territoryId: string; slots: number }[] = [];
  for (const region of Object.values(state.regions)) {
    if (region.owner_faction_id !== factionId || !region.has_factory || !region.isLandRegion()) {
      continue;
    }
    breakdown.push({ territoryId: region.id, slots: factorySlots(state, region) });
  }
  breakdown.sort((a, b) => (a.territoryId < b.territoryId ? -1 : a.territoryId > b.territoryId ? 1 : 0));
  return {
    maxUnits: breakdown.reduce((sum, row) => sum + row.slots, 0),
    breakdown,
  };
}

/**
 * Freeze the build cap at match start and again when mobilize ends.
 * The next purchase reads this, so a factory captured later waits until the following round.
 */
export function snapshotProduction(state: GameState, factionId = state.current_faction_id): void {
  if (factionId === "") {
    return;
  }
  state.turnBuildCapacity[factionId] = liveBuildCapacity(state, factionId);
}

/** Units this power may buy. The mobilize snapshot wins once it exists. */
export function purchaseUnitCap(state: GameState, factionId: string): number {
  const saved = state.turnBuildCapacity[factionId];
  if (saved != null) {
    return Math.max(0, Math.trunc(saved.maxUnits));
  }
  return liveBuildCapacity(state, factionId).maxUnits;
}

export function buildCapacityOf(state: GameState, factionId: string): TurnBuildCapacity {
  return state.turnBuildCapacity[factionId] ?? liveBuildCapacity(state, factionId);
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
