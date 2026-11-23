import type { GameState } from "../engine/model/game_state";
import { MovementValidator } from "../engine/movement/movement_validator";
import { VICTORY_CITIES } from "../engine/rules/optional/global1940Evaluator";
import { postureFaction, selectPosture } from "./theaterPostures";

export type Alliance = "axis" | "allies";

export type TheaterId =
  | "THEATER_EASTERN_FRONT"
  | "THEATER_WESTERN_EUROPE"
  | "THEATER_MED_AFRICA"
  | "THEATER_PACIFIC_ISLANDS"
  | "THEATER_CHINA_BURMA";

export interface PriorityReinforcementNode {
  territoryId: string;
  requestedBy: string;
  expiresAfterRound: number;
  minAirSupportDesired: number;
  urgencyScore: number;
}

export interface SoftenTargetRequest {
  territoryId: string;
  requestedBy: string;
  targetAlliance: Alliance;
  minAttritionRatio: number;
}

export interface AllianceWarPlan {
  alliance: Alliance;
  evaluatedRound: number;
  primaryTheater: TheaterId;
  secondaryTheater: TheaterId;
  factionPostures: Record<string, string>;
  priorityReinforcementNodes: PriorityReinforcementNode[];
  softenTargets: SoftenTargetRequest[];
}

const THEATERS: TheaterId[] = [
  "THEATER_EASTERN_FRONT",
  "THEATER_WESTERN_EUROPE",
  "THEATER_MED_AFRICA",
  "THEATER_PACIFIC_ISLANDS",
  "THEATER_CHINA_BURMA",
];

const TOKENS: Record<TheaterId, string[]> = {
  THEATER_EASTERN_FRONT: ["moscow", "leningrad", "stalingrad", "ukraine", "caucasus", "poland", "baltic", "karelia"],
  THEATER_WESTERN_EUROPE: ["france", "normandy", "norway", "berlin", "germany", "britain", "london", "uk"],
  THEATER_MED_AFRICA: ["egypt", "gibraltar", "greece", "libya", "morocco", "algeria", "malta", "italy", "rome", "turkey"],
  THEATER_PACIFIC_ISLANDS: ["philippines", "solomon", "caroline", "japan", "tokyo", "guam", "iwo", "okinawa", "java", "sumatra", "borneo", "indies"],
  THEATER_CHINA_BURMA: ["yunnan", "szechwan", "burma", "india", "malaya"],
};

const plans = new WeakMap<GameState, { stamp: string; axis: AllianceWarPlan; allies: AllianceWarPlan }>();

function textOf(state: GameState, regionId: string): string {
  const region = state.regions[regionId];
  return `${regionId} ${region?.name ?? ""}`.toLowerCase();
}

export function theaterOfRegion(state: GameState, regionId: string): TheaterId | "" {
  const text = textOf(state, regionId);
  for (const theater of THEATERS) {
    if (TOKENS[theater].some((token) => text.includes(token))) {
      return theater;
    }
  }
  return "";
}

function unitCost(state: GameState, regionId: string, friendly: boolean, factionId: string): number {
  let total = 0;
  for (const entry of state.getUnitsInRegion(regionId)) {
    const owner = String(entry.faction_id ?? "");
    if (owner === "" || state.sameTeam(owner, factionId) !== friendly) {
      continue;
    }
    const cost = Math.max(0, state.unit_types[String(entry.unit_type_id ?? "")]?.cost ?? 0);
    total += cost * Math.max(0, Math.trunc(Number(entry.count ?? 0)));
  }
  return total;
}

export function tuvInTheater(state: GameState, factionId: string, theater: TheaterId, friendly: boolean): number {
  let total = 0;
  for (const regionId of Object.keys(state.regions)) {
    if (theaterOfRegion(state, regionId) !== theater) {
      continue;
    }
    total += unitCost(state, regionId, friendly, factionId);
  }
  return total;
}

function unclaimedObjectiveValue(state: GameState, alliance: Alliance, theater: TheaterId): number {
  let total = 0;
  for (const goal of state.nationalObjectives) {
    const team = state.factions[goal.factionId]?.team === "axis" ? "axis" : "allies";
    if (team !== alliance) {
      continue;
    }
    const open = goal.holds.some((regionId) => {
      const owner = state.regions[regionId]?.owner_faction_id ?? "";
      return owner === "" || (state.factions[owner]?.team === "axis" ? "axis" : "allies") !== alliance;
    });
    const here = goal.holds.some((regionId) => theaterOfRegion(state, regionId) === theater);
    if (open && here) {
      total += Math.max(0, Math.trunc(goal.production));
    }
    if (goal.id === "NO_ITA_MARE_NOSTRUM" && theater === "THEATER_MED_AFRICA" && open) {
      total += Math.max(5, Math.trunc(goal.production));
    }
  }
  return total;
}

function capitalThreat(state: GameState, alliance: Alliance, theater: TheaterId): number {
  let threat = 0;
  for (const region of Object.values(state.regions)) {
    if (!region.is_capital || theaterOfRegion(state, region.id) !== theater) {
      continue;
    }
    const ownerTeam = state.factions[region.owner_faction_id]?.team === "axis" ? "axis" : "allies";
    if (region.owner_faction_id === "" || ownerTeam !== alliance) {
      continue;
    }
    for (const near of state.getAdjacentRegions(region.id)) {
      threat += unitCost(state, near, false, region.owner_faction_id);
    }
  }
  return threat;
}

function theaterScore(state: GameState, alliance: Alliance, theater: TheaterId): number {
  const sample = alliance === "axis" ? "germany" : "united_kingdom";
  const faction = state.factions[sample] != null ? sample : Object.keys(state.factions).find((id) => state.factions[id]?.team === alliance) ?? sample;
  const enemy = tuvInTheater(state, faction, theater, false);
  const friendly = tuvInTheater(state, faction, theater, true);
  return enemy * 1.5 + capitalThreat(state, alliance, theater) + unclaimedObjectiveValue(state, alliance, theater) * 5 - friendly * 0.25;
}

function blank(alliance: Alliance, round: number, primary: TheaterId, secondary: TheaterId): AllianceWarPlan {
  return {
    alliance,
    evaluatedRound: round,
    primaryTheater: primary,
    secondaryTheater: secondary,
    factionPostures: {},
    priorityReinforcementNodes: [],
    softenTargets: [],
  };
}

export function evaluateAllianceWarPlan(state: GameState, alliance: Alliance): AllianceWarPlan {
  const ranked = THEATERS.map((theater) => ({ theater, score: theaterScore(state, alliance, theater) })).sort(
    (a, b) => b.score - a.score || (a.theater < b.theater ? -1 : 1),
  );
  const plan = blank(alliance, state.game_round, ranked[0]?.theater ?? "THEATER_EASTERN_FRONT", ranked[1]?.theater ?? "THEATER_WESTERN_EUROPE");
  for (const factionId of Object.keys(state.factions)) {
    const team = state.factions[factionId]?.team === "axis" ? "axis" : state.factions[factionId]?.team === "allies" ? "allies" : "";
    if (team !== alliance) {
      continue;
    }
    const posture = selectPosture(state, factionId, plan);
    if (posture != null) {
      plan.factionPostures[postureFaction(factionId)] = posture.id;
      plan.factionPostures[factionId] = posture.id;
    }
  }
  return plan;
}

function boardStamp(state: GameState): string {
  const owners: string[] = [];
  for (const region of Object.values(state.regions)) {
    const city = (VICTORY_CITIES as readonly string[]).includes(region.id);
    if (region.is_capital || city) {
      owners.push(`${region.id}:${region.owner_faction_id}`);
    }
  }
  owners.sort();
  return `${state.game_round}|${owners.join("|")}`;
}

export function ensureAlliancePlans(state: GameState): { axis: AllianceWarPlan; allies: AllianceWarPlan } {
  const stamp = boardStamp(state);
  const cached = plans.get(state);
  if (cached != null && cached.stamp === stamp) {
    return { axis: cached.axis, allies: cached.allies };
  }
  const next = { stamp, axis: evaluateAllianceWarPlan(state, "axis"), allies: evaluateAllianceWarPlan(state, "allies") };
  plans.set(state, next);
  return { axis: next.axis, allies: next.allies };
}

export function planForFaction(state: GameState, factionId: string): AllianceWarPlan | null {
  const cached = plans.get(state);
  if (cached == null) {
    return null;
  }
  return state.factions[factionId]?.team === "axis" ? cached.axis : cached.allies;
}

function reachableEnemyTuv(state: GameState, territoryId: string, factionId: string): number {
  const validator = new MovementValidator();
  let total = 0;
  const seen = new Set<string>();
  for (const regionId of Object.keys(state.region_units)) {
    for (const entry of state.getUnitsInRegion(regionId)) {
      const owner = String(entry.faction_id ?? "");
      if (owner === "" || state.sameTeam(owner, factionId)) {
        continue;
      }
      const unit = state.unit_types[String(entry.unit_type_id ?? "")];
      if (unit == null || unit.movement <= 0) {
        continue;
      }
      const reached = validator.floodFill(regionId, Math.min(2, unit.movement), state, unit.category === "sea", owner, unit.category === "air", unit.id);
      if (regionId !== territoryId && !reached.includes(territoryId)) {
        continue;
      }
      const key = `${regionId}|${owner}|${entry.unit_type_id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      total += Math.max(0, unit.cost) * Math.max(0, Math.trunc(Number(entry.count ?? 0)));
    }
  }
  return total;
}

function garrisonTuv(state: GameState, territoryId: string, factionId: string): number {
  return unitCost(state, territoryId, true, factionId);
}

export function registerReinforcementNode(state: GameState, territoryId: string, requestedBy: string): PriorityReinforcementNode | null {
  const held = ensureAlliancePlans(state);
  const plan = state.factions[requestedBy]?.team === "axis" ? held.axis : held.allies;
  const garrison = garrisonTuv(state, territoryId, requestedBy);
  const counter = reachableEnemyTuv(state, territoryId, requestedBy);
  if (garrison <= 0 || counter <= garrison * 0.75) {
    return null;
  }
  const node: PriorityReinforcementNode = {
    territoryId,
    requestedBy,
    expiresAfterRound: state.game_round + 1,
    minAirSupportDesired: 2,
    urgencyScore: counter / garrison,
  };
  plan.priorityReinforcementNodes = plan.priorityReinforcementNodes.filter((row) => row.territoryId !== territoryId);
  plan.priorityReinforcementNodes.push(node);
  return node;
}

export function registerSoftenTarget(state: GameState, request: SoftenTargetRequest): void {
  const held = ensureAlliancePlans(state);
  const plan = request.targetAlliance === "axis" ? held.allies : held.axis;
  plan.softenTargets = plan.softenTargets.filter((row) => row.territoryId !== request.territoryId || row.requestedBy !== request.requestedBy);
  plan.softenTargets.push(request);
}

export function reinforcementLandingRank(state: GameState, factionId: string, regionId: string, fighters: number): number {
  const plan = planForFaction(state, factionId);
  if (plan == null) {
    return 0;
  }
  const node = plan.priorityReinforcementNodes.find((row) => row.territoryId === regionId && row.expiresAfterRound >= state.game_round);
  if (node == null || garrisonTuv(state, regionId, factionId) <= 0) {
    return 0;
  }
  return 15 * Math.min(fighters, node.minAirSupportDesired);
}

export function softenAttackBonus(state: GameState, factionId: string, regionId: string, expectedDestroyed: number, risked: number): number {
  const plan = planForFaction(state, factionId);
  if (plan == null || expectedDestroyed <= risked) {
    return 0;
  }
  const hit = plan.softenTargets.some((row) => row.territoryId === regionId && row.requestedBy !== factionId);
  return hit ? 12 : 0;
}

export function theaterProgressValue(state: GameState, factionId: string, regionId: string, base: number): number {
  const plan = planForFaction(state, factionId);
  if (plan == null) {
    return base;
  }
  const postureId = plan.factionPostures[postureFaction(factionId)] ?? plan.factionPostures[factionId] ?? "";
  const theater = theaterOfRegion(state, regionId);
  if (theater !== "" && theater === plan.primaryTheater && postureId !== "") {
    return base * 2.5;
  }
  return base;
}

export function coalitionAttackAdjust(
  state: GameState,
  factionId: string,
  regionId: string,
  base: number,
  expectedDestroyed: number,
  risked: number,
): number {
  return theaterProgressValue(state, factionId, regionId, base) + softenAttackBonus(state, factionId, regionId, expectedDestroyed, risked);
}
