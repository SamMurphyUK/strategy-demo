import type { GameState } from "../engine/model/game_state";
import { planPurchaseRepairs } from "../engine/rules/optional/bombingResolver";
import { RESEARCH_TECHS } from "../engine/rules/optional/techTree";
import { classifyUnit } from "../engine/types/ruleset";
import { simulateBattleOdds } from "./battleOddsSim";
import type { TileThreat } from "./threatMap";
import type { CommanderWeights } from "./types/aiTypes";

export interface PurchaseLine {
  unit_type_id: string;
  count: number;
}

export interface ResearchBuy {
  tech: string;
  count: number;
}

export interface PlacementLine {
  region_id: string;
  units: PurchaseLine[];
}

export interface PurchasePlan {
  purchases: PurchaseLine[];
  repairs: { region_id: string; tokens: number }[];
  research: ResearchBuy[];
  placements: PlacementLine[];
  spent: number;
}

interface Priced {
  id: string;
  cost: number;
  kind: string;
}

const MARITIME = new Set(["uk", "united_kingdom", "usa", "united_states", "japan", "jap", "anzac"]);
const RESEARCH_TOKEN = 5;

function catalog(state: GameState): Priced[] {
  const rows: Priced[] = [];
  for (const id of Object.keys(state.unit_types)) {
    const unit = state.unit_types[id];
    if (unit == null || unit.cost <= 0) {
      continue;
    }
    rows.push({ id, cost: unit.cost, kind: classifyUnit(id) ?? unit.category });
  }
  return rows.sort((a, b) => a.cost - b.cost);
}

function findKind(units: readonly Priced[], kinds: readonly string[]): Priced | undefined {
  return units.find((unit) => kinds.includes(unit.kind) || kinds.includes(unit.id));
}

function capitalOf(state: GameState, factionId: string): { regionId: string; room: number } | null {
  for (const region of Object.values(state.regions)) {
    if (region.is_capital && region.has_factory && region.owner_faction_id === factionId && region.isLandRegion()) {
      return { regionId: region.id, room: Math.max(0, region.ipc_value) };
    }
  }
  return null;
}

function factoryRoom(state: GameState, factionId: string): { regionId: string; room: number } | null {
  return (
    capitalOf(state, factionId) ??
    Object.values(state.regions)
      .filter((region) => region.has_factory && region.owner_faction_id === factionId && region.isLandRegion())
      .map((region) => ({ regionId: region.id, room: Math.max(0, region.ipc_value) }))
      .sort((a, b) => b.room - a.room)[0] ??
    null
  );
}

/** Chance the adjacent enemy takes the capital on its next attack. */
export function capitalCaptureOdds(state: GameState, factionId: string): number {
  let worst = 0;
  for (const region of Object.values(state.regions)) {
    if (!region.is_capital || region.owner_faction_id !== factionId) {
      continue;
    }
    const defenders: number[] = [];
    for (const entry of state.getUnitsInRegion(region.id)) {
      const owner = String(entry.faction_id ?? "");
      if (owner === "" || !state.sameTeam(owner, factionId)) {
        continue;
      }
      const unit = state.unit_types[String(entry.unit_type_id ?? "")];
      if (unit == null || unit.defense <= 0) {
        continue;
      }
      const count = Math.max(0, Math.trunc(Number(entry.count ?? 0)));
      for (let i = 0; i < count; i += 1) {
        defenders.push(unit.defense);
      }
    }
    const attackers: number[] = [];
    for (const near of state.getAdjacentRegions(region.id)) {
      for (const entry of state.getUnitsInRegion(near)) {
        const owner = String(entry.faction_id ?? "");
        if (owner === "" || state.sameTeam(owner, factionId)) {
          continue;
        }
        const unit = state.unit_types[String(entry.unit_type_id ?? "")];
        if (unit == null || unit.attack <= 0) {
          continue;
        }
        const count = Math.max(0, Math.trunc(Number(entry.count ?? 0)));
        for (let i = 0; i < count; i += 1) {
          attackers.push(unit.attack);
        }
      }
    }
    if (attackers.length === 0) {
      continue;
    }
    const odds = defenders.length === 0 ? 1 : simulateBattleOdds(attackers, defenders, 80, 11, state.rulesetConfig).win;
    worst = Math.max(worst, odds);
  }
  return worst;
}

function addLine(lines: Map<string, number>, id: string, count: number): void {
  lines.set(id, (lines.get(id) ?? 0) + count);
}

function toLines(lines: Map<string, number>): PurchaseLine[] {
  return [...lines.entries()].filter(([, count]) => count > 0).map(([unit_type_id, count]) => ({ unit_type_id, count }));
}

function coastalGround(state: GameState, factionId: string): number {
  let total = 0;
  for (const region of Object.values(state.regions)) {
    if (!region.isLandRegion() || region.owner_faction_id !== factionId) {
      continue;
    }
    const coast = state.getAdjacentRegions(region.id).some((id) => state.regions[id]?.isSeaRegion() === true);
    if (!coast) {
      continue;
    }
    for (const entry of state.getUnitsInRegion(region.id)) {
      if (String(entry.faction_id ?? "") !== factionId) {
        continue;
      }
      const kind = classifyUnit(String(entry.unit_type_id ?? ""));
      if (kind === "INFANTRY" || kind === "ARTILLERY" || kind === "ARMOR" || kind === "CHINESE_GUERRILLA") {
        total += Math.max(0, Math.trunc(Number(entry.count ?? 0)));
      }
    }
  }
  return total;
}

function ownedCount(state: GameState, factionId: string, kinds: readonly string[]): number {
  let total = 0;
  for (const entries of Object.values(state.region_units)) {
    for (const entry of entries ?? []) {
      if (String(entry.faction_id ?? "") !== factionId) {
        continue;
      }
      const kind = classifyUnit(String(entry.unit_type_id ?? ""));
      if (kind != null && kinds.includes(kind)) {
        total += Math.max(0, Math.trunc(Number(entry.count ?? 0)));
      }
    }
  }
  return total;
}

/**
 * Buys after the combat package is chosen. Spends only the faction's own treasury.
 * A capital under heavy threat is filled with infantry, artillery, and anti-aircraft first.
 */
export function planPurchase(
  state: GameState,
  factionId: string,
  _weights: CommanderWeights,
  tiles: readonly TileThreat[],
): PurchasePlan {
  const treasury = Math.max(0, Math.trunc(state.ipc[factionId] ?? 0));
  let left = treasury;
  const repairs: { region_id: string; tokens: number }[] = [];
  const bought = new Map<string, number>();
  const units = catalog(state);
  const infantry = findKind(units, ["INFANTRY", "CHINESE_GUERRILLA", "infantry"]);
  const artillery = findKind(units, ["ARTILLERY", "artillery"]);
  const armor = findKind(units, ["ARMOR", "FIGHTER", "tank", "fighter"]);
  const aa = findKind(units, ["aa_gun", "anti_aircraft", "aaa"]);
  const transport = findKind(units, ["TRANSPORT", "transport"]);
  const escort = findKind(units, ["DESTROYER", "CARRIER", "destroyer", "carrier"]);
  const fighter = findKind(units, ["FIGHTER", "fighter"]);
  const factory = factoryRoom(state, factionId);
  let room = factory?.room ?? 0;
  const capital = capitalOf(state, factionId);
  const locked = capital != null && capitalCaptureOdds(state, factionId) > 0.5;
  if (locked && capital != null) {
    const fillers = [infantry, artillery, aa].filter((unit): unit is Priced => unit != null);
    const defenseGoal = treasury * 0.8;
    let defenseSpent = 0;
    let guard = 0;
    while (defenseSpent < defenseGoal && left > 0 && room > 0 && fillers.length > 0 && guard < 40) {
      guard += 1;
      const next = fillers.find((unit) => unit.cost <= left);
      if (next == null) {
        break;
      }
      addLine(bought, next.id, 1);
      left -= next.cost;
      defenseSpent += next.cost;
      room -= 1;
    }
  }

  if (state.rulesetConfig.facilitiesAndPatrols) {
    const fronts = tiles
      .filter((tile) => {
        const region = state.regions[tile.regionId];
        return region?.major_factory === true && region.owner_faction_id === factionId && tile.enemyThreat1Turn > 0 && (state.repairTokens[tile.regionId] ?? 0) > 0;
      })
      .sort((a, b) => b.enemyThreat1Turn - a.enemyThreat1Turn);
    for (const tile of fronts) {
      const tokens = Math.min(Math.trunc(state.repairTokens[tile.regionId] ?? 0), left);
      if (tokens <= 0) {
        continue;
      }
      const planned = planPurchaseRepairs(state, factionId, [{ regionId: tile.regionId, tokens }]);
      if ("error" in planned || planned.spend > left) {
        continue;
      }
      repairs.push({ region_id: tile.regionId, tokens: planned.spend });
      left -= planned.spend;
    }
  }

  const research: ResearchBuy[] = [];
  const beforeTheater = left;
  if (state.rulesetConfig.techTree === true && beforeTheater >= 25) {
    const unlocked = new Set(state.researchUnlocked[factionId] ?? []);
    const next = RESEARCH_TECHS.find((tech) => !unlocked.has(tech.id));
    if (next != null && left >= RESEARCH_TOKEN) {
      left -= RESEARCH_TOKEN;
      research.push({ tech: next.id, count: 1 });
    }
  }

  if (!locked && room > 0 && left > 0) {
    const maritime = MARITIME.has(factionId.trim().toLowerCase());
    let inf = 0;
    let art = 0;
    let heavy = 0;
    let guard = 0;
    while (left > 0 && room > 0 && guard < 40) {
      guard += 1;
      const total = Math.max(1, inf + art + heavy);
      if (infantry != null && inf / total < 0.55 && infantry.cost <= left) {
        addLine(bought, infantry.id, 1);
        inf += 1;
        left -= infantry.cost;
        room -= 1;
        continue;
      }
      if (artillery != null && art < inf && art / total < 0.25 && artillery.cost <= left) {
        addLine(bought, artillery.id, 1);
        art += 1;
        left -= artillery.cost;
        room -= 1;
        continue;
      }
      if (armor != null && heavy / total < 0.2 && armor.cost <= left) {
        addLine(bought, armor.id, 1);
        heavy += 1;
        left -= armor.cost;
        room -= 1;
        continue;
      }
      if (infantry != null && infantry.cost <= left) {
        addLine(bought, infantry.id, 1);
        inf += 1;
        left -= infantry.cost;
        room -= 1;
        continue;
      }
      break;
    }
    if (maritime) {
      const ground = coastalGround(state, factionId) + inf + art + heavy;
      const pairs = Math.floor(ground / 8);
      const needTransport = Math.max(0, pairs - ownedCount(state, factionId, ["TRANSPORT"]));
      const needEscort = Math.max(0, pairs - ownedCount(state, factionId, ["DESTROYER", "CARRIER"]));
      if (transport != null && needTransport > 0 && room > 0 && left >= transport.cost) {
        addLine(bought, transport.id, 1);
        left -= transport.cost;
        room -= 1;
      }
      if (escort != null && needEscort > 0 && room > 0 && left >= escort.cost) {
        addLine(bought, escort.id, 1);
        left -= escort.cost;
        room -= 1;
      }
      if (fighter != null && room > 0 && left >= fighter.cost && heavy === 0) {
        addLine(bought, fighter.id, 1);
        left -= fighter.cost;
        room -= 1;
      }
    }
  }

  const purchases = toLines(bought);
  const placements: PlacementLine[] = [];
  if (factory != null && purchases.length > 0) {
    placements.push({ region_id: factory.regionId, units: purchases });
  }
  return { purchases, repairs, research, placements, spent: treasury - left };
}
