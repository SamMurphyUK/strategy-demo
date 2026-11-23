import type { GameState } from "../engine/model/game_state";
import { planPurchaseRepairs } from "../engine/rules/optional/bombingResolver";
import type { TileThreat } from "./threatMap";
import type { CommanderWeights } from "./types/aiTypes";

export interface PurchaseLine {
  unit_type_id: string;
  count: number;
}

export interface PurchasePlan {
  purchases: PurchaseLine[];
  repairs: { region_id: string; tokens: number }[];
  spent: number;
}

function catalog(state: GameState): { id: string; cost: number; attack: number; defense: number }[] {
  const rows = [];
  for (const id of Object.keys(state.unit_types)) {
    const unit = state.unit_types[id];
    if (unit == null || unit.cost <= 0 || unit.category === "sea") {
      continue;
    }
    rows.push({ id, cost: unit.cost, attack: unit.attack, defense: unit.defense });
  }
  return rows.sort((a, b) => a.cost - b.cost);
}

function factoryCapacity(state: GameState, factionId: string): { regionId: string; room: number } | null {
  let best: { regionId: string; room: number } | null = null;
  for (const region of Object.values(state.regions)) {
    if (!region.has_factory || region.owner_faction_id !== factionId || !region.isLandRegion()) {
      continue;
    }
    const room = Math.max(0, region.ipc_value);
    if (best == null || room > best.room) {
      best = { regionId: region.id, room };
    }
  }
  return best;
}

function capitalThreatened(state: GameState, factionId: string, tiles: readonly TileThreat[]): boolean {
  for (const region of Object.values(state.regions)) {
    if (!region.is_capital || region.owner_faction_id !== factionId) {
      continue;
    }
    const threat = tiles.find((tile) => tile.regionId === region.id);
    if (threat != null && threat.enemyThreat1Turn > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Buys after the combat package is chosen. Spends only the faction's own treasury.
 * A threatened capital buys infantry. Otherwise the persona picks tank, fighter, or infantry.
 */
export function planPurchase(
  state: GameState,
  factionId: string,
  weights: CommanderWeights,
  tiles: readonly TileThreat[],
): PurchasePlan {
  const treasury = Math.max(0, Math.trunc(state.ipc[factionId] ?? 0));
  const repairs: { region_id: string; tokens: number }[] = [];
  let reserved = 0;
  if (state.rulesetConfig.facilitiesAndPatrols) {
    for (const regionId of Object.keys(state.repairTokens)) {
      const planned = planPurchaseRepairs(state, factionId, [{ regionId, tokens: 1 }]);
      if ("error" in planned) {
        continue;
      }
      repairs.push({ region_id: regionId, tokens: planned.spend });
      reserved += planned.spend;
      break;
    }
  }
  let left = treasury - reserved;
  const factory = factoryCapacity(state, factionId);
  const room = factory?.room ?? 0;
  const units = catalog(state);
  const infantry = units.find((unit) => unit.id === "infantry") ?? units.find((unit) => unit.defense > 0 && unit.cost <= 4);
  const tank = units.find((unit) => unit.id === "tank" || unit.id === "armor");
  const fighter = units.find((unit) => unit.id === "fighter");
  const purchases: PurchaseLine[] = [];
  const threatened = capitalThreatened(state, factionId, tiles);
  const prefer =
    threatened || weights.personaId === "ATTRITIONAL"
      ? infantry
      : weights.personaId === "MARITIME"
        ? fighter ?? infantry
        : tank ?? infantry;
  if (prefer != null && room > 0 && left >= prefer.cost) {
    const count = Math.min(room, Math.floor(left / prefer.cost));
    if (count > 0) {
      purchases.push({ unit_type_id: prefer.id, count });
      left -= prefer.cost * count;
    }
  }
  return { purchases, repairs, spent: treasury - left };
}
