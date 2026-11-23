import type { GameState } from "../../model/game_state";
import { RESEARCH_COST } from "./tech";

export interface ResearchTech {
  id: string;
  chart: "land" | "air";
  name: string;
}

/** Land and industry, then air and naval. */
export const RESEARCH_TECHS: ResearchTech[] = [
  { id: "improved_artillery", chart: "land", name: "Improved Artillery" },
  { id: "heavy_armor", chart: "land", name: "Heavy Armor" },
  { id: "war_bonds", chart: "land", name: "War Bonds" },
  { id: "radar_flak", chart: "land", name: "Radar & Flak" },
  { id: "jet_fighters", chart: "air", name: "Jet Fighters" },
  { id: "heavy_bombers", chart: "air", name: "Heavy Bombers" },
  { id: "long_range_aircraft", chart: "air", name: "Long-Range Aircraft" },
  { id: "super_subs_sonar", chart: "air", name: "Super Subs & Sonar" },
];

const KNOWN = new Set(RESEARCH_TECHS.map((tech) => tech.id));

export interface ResearchOrder {
  tech: string;
  count: number;
}

export function hasTech(state: GameState, factionId: string, techId: string): boolean {
  return state.rulesetConfig.techTree === true && (state.researchUnlocked[factionId] ?? []).includes(techId);
}

/**
 * Each token costs 5 Industrial Output during purchase.
 * The dice are rolled when the purchase phase ends.
 */
export function buyResearch(state: GameState, factionId: string, orders: ResearchOrder[]): string | null {
  if (state.rulesetConfig.techTree !== true) {
    return "Research is off.";
  }
  if (state.current_phase !== "purchase" || state.current_faction_id !== factionId) {
    return "Research is bought during purchase.";
  }
  const unlocked = new Set(state.researchUnlocked[factionId] ?? []);
  let tokens = 0;
  const queued: string[] = [];
  for (const order of orders) {
    const tech = String(order.tech ?? "");
    const count = Math.trunc(Number(order.count ?? 0));
    if (!KNOWN.has(tech)) {
      return "Unknown research.";
    }
    if (unlocked.has(tech)) {
      return "That research is already unlocked.";
    }
    if (count < 1) {
      return "Buy at least one research token.";
    }
    tokens += count;
    for (let i = 0; i < count; i += 1) {
      queued.push(tech);
    }
  }
  if (tokens === 0) {
    return null;
  }
  const cost = tokens * RESEARCH_COST;
  const treasury = Math.trunc(state.ipc[factionId] ?? 0);
  if (treasury < cost) {
    return "Not enough Industrial Output.";
  }
  state.ipc[factionId] = treasury - cost;
  const pending = state.researchPending[factionId] ?? [];
  state.researchPending[factionId] = [...pending, ...queued];
  return null;
}

/**
 * One die per token. A 6, plus pity carried from earlier turns, unlocks that tech.
 * A turn that unlocks nothing carries one pip forward.
 */
export function rollResearchPhase(state: GameState, factionId: string, roll: () => number): string[] {
  if (state.rulesetConfig.techTree !== true) {
    return [];
  }
  const pending = state.researchPending[factionId] ?? [];
  if (pending.length === 0) {
    return [];
  }
  const pity = Math.max(0, Math.trunc(state.researchPity[factionId] ?? 0));
  const unlocked = [...(state.researchUnlocked[factionId] ?? [])];
  const gained: string[] = [];
  for (const tech of pending) {
    const face = Math.min(6, Math.max(1, Math.trunc(Number(roll()))));
    if (face + pity >= 6 && !unlocked.includes(tech)) {
      unlocked.push(tech);
      gained.push(tech);
    }
  }
  state.researchUnlocked[factionId] = unlocked;
  state.researchPity[factionId] = gained.length > 0 ? 0 : pity + 1;
  delete state.researchPending[factionId];
  return gained;
}
