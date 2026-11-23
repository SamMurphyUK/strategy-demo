import { Faction } from "../../model/faction";
import type { GameState } from "../../model/game_state";
import type { NeutralBloc } from "./objectives";
import { classifyUnit } from "../../types/ruleset";

export const GERMANY = "germany";
export const SOVIET_UNION = "soviet_union";
export const JAPAN = "japan";
export const UNITED_KINGDOM = "united_kingdom";
export const ITALY = "italy";
export const CHINA = "china";
export const UNITED_STATES = "united_states";
export const ANZAC = "anzac";
export const FREE_FRANCE = "free_france";

/** GERMANY, then the Soviet Union, Japan, Britain, Italy, China, and the United States. */
export const TURN_ORDER = [GERMANY, SOVIET_UNION, JAPAN, UNITED_KINGDOM, ITALY, CHINA, UNITED_STATES];

const AXIS = new Set([GERMANY, ITALY, JAPAN]);

/** Thirteen victory cities. Berlin, Rome, and Tokyo are the Axis capitals. */
export const VICTORY_CITIES = [
  "berlin",
  "rome",
  "paris",
  "warsaw",
  "london",
  "moscow",
  "cairo",
  "tokyo",
  "shanghai",
  "manila",
  "calcutta",
  "sydney",
  "washington",
] as const;

export const AXIS_CAPITALS = ["berlin", "rome", "tokyo"] as const;

const OBJECTIVE_PAY = 5;

const CHINA_CORE = new Set(["yunnan", "szechwan", "shansi", "kweichow", "suiyuan", "hunan"]);
const BURMA_ROAD = ["india", "burma", "yunnan"];

export const GLOBAL_BLOCS: NeutralBloc[] = [
  { id: "BLOC_IBERIA", members: ["spain", "portugal"], joins: "", oppose: true, garrison: 1 },
  { id: "BLOC_NORDIC", members: ["sweden", "norway", "finland"], joins: "", oppose: true, garrison: 1 },
  { id: "BLOC_TURKEY", members: ["turkey", "northwest_persia"], joins: "", oppose: true, garrison: 1 },
  { id: "BLOC_SOUTH_AMERICA", members: ["argentina", "chile", "brazil", "venezuela"], joins: "", oppose: true, garrison: 1 },
];

function isGlobal(state: GameState): boolean {
  return state.scenarioId === "SCENARIO_GLOBAL_1940";
}

function owns(state: GameState, factionId: string, regionId: string): boolean {
  return state.regions[regionId]?.owner_faction_id === factionId;
}

function ownsAny(state: GameState, factionId: string, regions: string[]): boolean {
  return regions.some((regionId) => owns(state, factionId, regionId));
}

function ownsAll(state: GameState, factionId: string, regions: string[]): boolean {
  return regions.every((regionId) => owns(state, factionId, regionId));
}

function teamHolds(state: GameState, factionIds: string[], regionId: string): boolean {
  const owner = state.regions[regionId]?.owner_faction_id ?? "";
  return factionIds.includes(owner);
}

function submarinesAtSea(state: GameState, factionId: string): number {
  let total = 0;
  for (const regionId of Object.keys(state.regions)) {
    const region = state.regions[regionId];
    if (region == null || !region.isSeaRegion()) {
      continue;
    }
    for (const entry of state.region_units[regionId] ?? []) {
      if (entry.faction_id !== factionId || classifyUnit(String(entry.unit_type_id ?? "")) !== "SUBMARINE") {
        continue;
      }
      total += Math.max(0, Math.trunc(Number(entry.count ?? 0)));
    }
  }
  return total;
}

/** Named 1940 objectives. Each one pays 5 Industrial Output. The flag keeps this at zero. */
export function globalObjectivePay(state: GameState, factionId: string): number {
  if (!state.rulesetConfig.nationalObjectivesAndNeutrals) {
    return 0;
  }
  let pay = 0;
  if (factionId === GERMANY && ownsAny(state, GERMANY, ["caucasus", "persia", "iraq"])) {
    pay += OBJECTIVE_PAY;
  }
  if (factionId === GERMANY && submarinesAtSea(state, GERMANY) >= 3) {
    pay += OBJECTIVE_PAY;
  }
  if (factionId === JAPAN && ownsAll(state, JAPAN, ["sumatra", "java", "borneo", "celebes"])) {
    pay += OBJECTIVE_PAY;
  }
  if (factionId === JAPAN && ownsAll(state, JAPAN, ["malaya", "philippines"])) {
    pay += OBJECTIVE_PAY;
  }
  if (factionId === ITALY && ownsAll(state, ITALY, ["egypt", "greece", "gibraltar"])) {
    pay += OBJECTIVE_PAY;
  }
  if (factionId === SOVIET_UNION && owns(state, SOVIET_UNION, "arkhangelsk")) {
    pay += OBJECTIVE_PAY;
  }
  if (factionId === SOVIET_UNION && ownsAll(state, SOVIET_UNION, ["moscow", "leningrad", "stalingrad"])) {
    pay += OBJECTIVE_PAY;
  }
  if (factionId === UNITED_KINGDOM && ownsAll(state, UNITED_KINGDOM, ["gibraltar", "egypt"])) {
    pay += OBJECTIVE_PAY;
  }
  if (
    factionId === UNITED_KINGDOM &&
    ["canada", "south_africa", "india", "australia", "new_zealand"].every((regionId) =>
      teamHolds(state, [UNITED_KINGDOM, ANZAC], regionId),
    )
  ) {
    pay += OBJECTIVE_PAY;
  }
  return pay;
}

/** Britain moves ANZAC. Free France is absorbed on round 2, so it is not commanded. */
export function commandedFactions(state: GameState, factionId: string): string[] {
  if (!isGlobal(state) || factionId !== UNITED_KINGDOM) {
    return [];
  }
  return [ANZAC];
}

export function commandedIncome(state: GameState, factionId: string): number {
  let total = 0;
  for (const owner of commandedFactions(state, factionId)) {
    for (const region of Object.values(state.regions)) {
      if (region.owner_faction_id === owner && region.isLandRegion()) {
        total += region.ipc_value;
      }
    }
  }
  return total;
}

/**
 * Soviet wartime income is +10. American wartime income is +26.
 * An early offensive keeps that bonus until round 5.
 */
export function wartimeStipend(state: GameState, factionId: string): number {
  if (!isGlobal(state)) {
    return 0;
  }
  if (factionId !== SOVIET_UNION && factionId !== UNITED_STATES) {
    return 0;
  }
  if (state.warStatus[factionId] !== "WARTIME") {
    return 0;
  }
  const bonusRound = state.wartimeBonusRound[factionId] ?? 3;
  if (state.game_round < bonusRound) {
    return 0;
  }
  return factionId === SOVIET_UNION ? 10 : 26;
}

/** A hostile attack before round 3 puts the power at war and withholds the wartime bonus until round 5. */
export function declareOffensive(state: GameState, factionId: string): void {
  if (!isGlobal(state) || (factionId !== SOVIET_UNION && factionId !== UNITED_STATES)) {
    return;
  }
  if (state.warStatus[factionId] === "WARTIME" || state.game_round >= 3) {
    if (state.game_round >= 3 && state.warStatus[factionId] !== "WARTIME") {
      state.warStatus[factionId] = "WARTIME";
    }
    return;
  }
  state.warStatus[factionId] = "WARTIME";
  state.wartimeBonusRound[factionId] = 5;
}

export function noteOffensive(state: GameState, factionId: string, regionId: string): void {
  if (!isGlobal(state) || regionId === "" || !state.isRegionHostileTo(regionId, factionId)) {
    return;
  }
  declareOffensive(state, factionId);
}

export function advanceGlobalRound(state: GameState): void {
  if (!isGlobal(state)) {
    return;
  }
  if (state.game_round >= 2) {
    absorbFreeFrance(state);
  }
  if (state.game_round >= 3) {
    for (const factionId of [SOVIET_UNION, UNITED_STATES]) {
      if (state.warStatus[factionId] === "PEACETIME") {
        state.warStatus[factionId] = "WARTIME";
      }
    }
  }
}

function absorbFreeFrance(state: GameState): void {
  if (state.freeFranceAbsorbed) {
    return;
  }
  for (const region of Object.values(state.regions)) {
    if (region.owner_faction_id === FREE_FRANCE) {
      region.owner_faction_id = UNITED_KINGDOM;
    }
  }
  for (const units of Object.values(state.region_units)) {
    for (const entry of units) {
      if (entry.faction_id === FREE_FRANCE) {
        entry.faction_id = UNITED_KINGDOM;
      }
    }
  }
  const purse = Math.trunc(state.ipc[FREE_FRANCE] ?? 0);
  if (purse > 0) {
    state.ipc[UNITED_KINGDOM] = (state.ipc[UNITED_KINGDOM] ?? 0) + purse;
    state.ipc[FREE_FRANCE] = 0;
  }
  state.freeFranceAbsorbed = true;
}

function axisOwner(state: GameState, factionId: string): boolean {
  if (factionId === "") {
    return false;
  }
  if (state.factions[factionId]?.team === "axis" || AXIS.has(factionId)) {
    return true;
  }
  return false;
}

export interface CityVictory {
  winner: string;
  reason: string;
}

/** Null until the last power of the round has finished, or when nobody has won yet. */
export function scoreGlobalVictory(state: GameState): CityVictory | null {
  if (!isGlobal(state) || state.turn_order.length === 0) {
    return null;
  }
  if (state.current_faction_id !== state.turn_order[state.turn_order.length - 1]) {
    return null;
  }
  let axis = 0;
  let allies = 0;
  for (const city of VICTORY_CITIES) {
    const owner = state.regions[city]?.owner_faction_id ?? "";
    if (owner === "") {
      continue;
    }
    if (axisOwner(state, owner)) {
      axis += 1;
    } else {
      allies += 1;
    }
  }
  const capitals = AXIS_CAPITALS.every((city) => {
    const owner = state.regions[city]?.owner_faction_id ?? "";
    return owner !== "" && !axisOwner(state, owner);
  });
  if (capitals || allies >= 10) {
    const winner = !axisOwner(state, state.current_faction_id) ? state.current_faction_id : UNITED_KINGDOM;
    return { winner, reason: capitals ? "axis_capitals" : "victory_cities" };
  }
  if (axis >= 9) {
    const winner = axisOwner(state, state.current_faction_id) ? state.current_faction_id : GERMANY;
    return { winner, reason: "victory_cities" };
  }
  return null;
}

/**
 * China places at most two guerrillas on a core tile.
 * Artillery requires the Burma Road: India, Burma, and Yunnan held by the Allies.
 * "ok" means the guerrilla placement is finished. A string is an error. Null uses the factory rules.
 */
export function chinaPlacement(state: GameState, factionId: string, regionId: string, unitTypeId: string, count: number): "ok" | string | null {
  if (!isGlobal(state) || factionId !== CHINA) {
    return null;
  }
  const kind = classifyUnit(unitTypeId);
  if (kind === "CHINESE_GUERRILLA") {
    if (!CHINA_CORE.has(regionId)) {
      return "Guerrillas deploy on a Chinese core tile.";
    }
    const region = state.regions[regionId];
    if (region == null || region.owner_faction_id !== CHINA) {
      return `Region not owned by faction: ${regionId}`;
    }
    let have = 0;
    for (const entry of state.region_units[regionId] ?? []) {
      if (entry.faction_id === CHINA && classifyUnit(String(entry.unit_type_id ?? "")) === "CHINESE_GUERRILLA") {
        have += Math.max(0, Math.trunc(Number(entry.count ?? 0)));
      }
    }
    if (have + Math.max(0, Math.trunc(count)) > 2) {
      return "A core tile holds two guerrillas.";
    }
    return "ok";
  }
  if (kind === "ARTILLERY") {
    const open = BURMA_ROAD.every((id) => {
      const owner = state.regions[id]?.owner_faction_id ?? "";
      return owner !== "" && state.sameTeam(owner, CHINA);
    });
    if (!open) {
      return "The Burma Road is closed.";
    }
  }
  return null;
}

function addPower(state: GameState, id: string, name: string, color: string, team: string, treasury: number, order: number): void {
  const faction = Faction.fromDict({ id, name, color, starting_ipc: treasury, turn_order: order, team });
  state.factions[id] = faction;
  state.ipc[id] = treasury;
  state.pending_purchases[id] = state.pending_purchases[id] ?? [];
}

/** Seven powers, peacetime purses, and the four neutral blocs. */
export function installGlobal1940(state: GameState): void {
  if (!isGlobal(state)) {
    return;
  }
  const powers: [string, string, string, string, number][] = [
    [GERMANY, "Germany", "#4B4B4B", "axis", 0],
    [SOVIET_UNION, "Soviet Union", "#C0392B", "allies", 28],
    [JAPAN, "Japan", "#E6B325", "axis", 0],
    [UNITED_KINGDOM, "United Kingdom", "#1A3A8A", "allies", 0],
    [ITALY, "Italy", "#2E7D32", "axis", 0],
    [CHINA, "China", "#8A6A2F", "allies", 0],
    [UNITED_STATES, "United States", "#2F5D3A", "allies", 26],
    [ANZAC, "ANZAC", "#8B1E3F", "allies", 0],
    [FREE_FRANCE, "Free France", "#6C8EBF", "allies", 0],
  ];
  powers.forEach(([id, name, color, team, treasury], index) => {
    addPower(state, id, name, color, team, treasury, index + 1);
  });
  state.turn_order = [...TURN_ORDER];
  state.current_faction_id = GERMANY;
  state.current_phase = "purchase";
  state.game_round = 1;
  state.turn_number = 1;
  state.warStatus[SOVIET_UNION] = "PEACETIME";
  state.warStatus[UNITED_STATES] = "PEACETIME";
  state.wartimeBonusRound[SOVIET_UNION] = 3;
  state.wartimeBonusRound[UNITED_STATES] = 3;
  state.playedBy[CHINA] = UNITED_STATES;
  state.playedBy[ANZAC] = UNITED_KINGDOM;
  state.freeFranceAbsorbed = false;
  state.neutralBlocs = GLOBAL_BLOCS.map((bloc) => ({ ...bloc, members: [...bloc.members] }));
}
