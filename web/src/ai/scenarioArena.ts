import { GameSessionStub } from "../engine/session/game_session_stub";
import { VICTORY_CITIES, globalObjectivePay } from "../engine/rules/optional/global1940Evaluator";
import { launchForScenario, type ScenarioId } from "../engine/types/ruleset";
import { plannerSeed } from "./planAITurn";
import { planTurn } from "./planTurn";
import type { AIDifficulty } from "./types/aiTypes";

export interface ScenarioRequest {
  seed: number;
  scenario: ScenarioId;
  /** Bot_v2, the candidate. Bot_v1 stays on Easy. */
  difficulty?: AIDifficulty;
  maxRounds?: number;
}

export interface FactionIndustry {
  spent: number;
  destroyed: number;
}

export interface ScenarioGame {
  seed: number;
  scenario: ScenarioId;
  winner: string;
  winnerTeam: "axis" | "allies" | "";
  winReason: "" | "victory_cities" | "capital_capture";
  rounds: number;
  turnMs: number[];
  capitalCaptures: number;
  victoryCityCaptures: number;
  io: Record<string, FactionIndustry>;
  objectivesCompleted: number;
  objectivesPossible: number;
  blocInvasions: number;
}

export interface ScenarioReport {
  games: number;
  axisWins: number;
  alliesWins: number;
  draws: number;
  axisWinPercent: number;
  alliesWinPercent: number;
  wins: { victoryCities: number; capitalCaptures: number };
  averageRounds: number;
  averageTurnMs: number;
  ioEfficiency: Record<string, number>;
  nationalObjectiveCompletionRate: number;
  neutralBlocInvasionFrequency: number;
}

const NAMED_OBJECTIVES = 9;

function teamOf(session: GameSessionStub, factionId: string): "axis" | "allies" | "" {
  const team = session.state.factions[factionId]?.team ?? "";
  return team === "axis" || team === "allies" ? team : "";
}

function unitValue(session: GameSessionStub, factionId: string, friendly: boolean): number {
  let total = 0;
  for (const entries of Object.values(session.state.region_units)) {
    for (const entry of entries ?? []) {
      const owner = String(entry.faction_id ?? "");
      if (owner === "" || session.state.sameTeam(owner, factionId) !== friendly) {
        continue;
      }
      const cost = Math.max(0, session.state.unit_types[String(entry.unit_type_id ?? "")]?.cost ?? 0);
      total += cost * Math.max(0, Math.trunc(Number(entry.count ?? 0)));
    }
  }
  return total;
}

function noteIndustry(io: Record<string, FactionIndustry>, factionId: string): FactionIndustry {
  const row = io[factionId] ?? { spent: 0, destroyed: 0 };
  io[factionId] = row;
  return row;
}

function spendOf(session: GameSessionStub, payload: Record<string, unknown>): number {
  let total = 0;
  const purchases: unknown[] = Array.isArray(payload.purchases) ? payload.purchases : [];
  for (const line of purchases) {
    if (line == null || typeof line !== "object") {
      continue;
    }
    const row = line as Record<string, unknown>;
    const id = String(row.unit_type_id ?? "");
    const count = Math.max(0, Math.trunc(Number(row.count ?? 0)));
    total += count * Math.max(0, session.state.unit_types[id]?.cost ?? 0);
  }
  const repairs: unknown[] = Array.isArray(payload.repairs) ? payload.repairs : [];
  for (const line of repairs) {
    if (line == null || typeof line !== "object") {
      continue;
    }
    total += Math.max(0, Math.trunc(Number((line as Record<string, unknown>).tokens ?? 0)));
  }
  const research: unknown[] = Array.isArray(payload.research) ? payload.research : [];
  for (const line of research) {
    if (line == null || typeof line !== "object") {
      continue;
    }
    total += Math.max(0, Math.trunc(Number((line as Record<string, unknown>).count ?? 0))) * 5;
  }
  return total;
}

function winReason(session: GameSessionStub): ScenarioGame["winReason"] {
  const state = session.state;
  if (!state.game_over || state.winner_faction_id === "") {
    return "";
  }
  if (state.scenarioId !== "SCENARIO_GLOBAL_1940") {
    return "capital_capture";
  }
  const held = ["berlin", "rome", "tokyo"].every((id) => {
    const owner = state.regions[id]?.owner_faction_id ?? "";
    return owner !== "" && state.sameTeam(owner, state.winner_faction_id);
  });
  return held ? "capital_capture" : "victory_cities";
}

function objectives(session: GameSessionStub): { completed: number; possible: number } {
  const state = session.state;
  if (!state.rulesetConfig.nationalObjectivesAndNeutrals) {
    return { completed: 0, possible: 0 };
  }
  let completed = 0;
  for (const factionId of state.turn_order) {
    completed += Math.trunc(globalObjectivePay(state, factionId) / 5);
  }
  for (const goal of state.nationalObjectives) {
    if (goal.holds.length > 0 && goal.holds.every((id) => state.regions[id]?.owner_faction_id === goal.factionId)) {
      completed += 1;
    }
  }
  return { completed, possible: NAMED_OBJECTIVES + state.nationalObjectives.length };
}

function blocOwners(session: GameSessionStub): Map<string, string> {
  const owners = new Map<string, string>();
  for (const bloc of session.state.neutralBlocs) {
    for (const id of bloc.members) {
      owners.set(id, session.state.regions[id]?.owner_faction_id ?? "");
    }
  }
  return owners;
}

/** Demo map, then the scenario launch. Bot_v2 plays Axis. Bot_v1 plays the Allies. */
export function playScenarioMatch(request: ScenarioRequest): ScenarioGame {
  const session = new GameSessionStub();
  session.initializeDemo(request.seed);
  session.state.applyCampaignLaunch(launchForScenario(request.scenario));
  const maxRounds = Math.max(1, request.maxRounds ?? 8);
  const openedAt = session.state.game_round;
  const v2 = request.difficulty ?? "NORMAL";
  const cities = new Set<string>(VICTORY_CITIES);
  const cityOwners = new Map<string, string>();
  const capitals = new Map<string, string>();
  for (const region of Object.values(session.state.regions)) {
    if (region.is_capital) {
      capitals.set(region.id, region.owner_faction_id);
    }
    if (cities.has(region.id)) {
      cityOwners.set(region.id, region.owner_faction_id);
    }
  }
  const blocs = blocOwners(session);
  const io: Record<string, FactionIndustry> = {};
  const turnMs: number[] = [];
  let capitalCaptures = 0;
  let victoryCityCaptures = 0;
  let guard = 0;
  while (!session.state.game_over && session.state.game_round < openedAt + maxRounds && guard < 400) {
    guard += 1;
    const faction = session.state.current_faction_id;
    const stamp = `${faction}|${session.state.current_phase}|${session.state.turn_number}|${session.state.game_round}`;
    if (session.state.current_phase !== "purchase" && session.state.current_phase !== "collect_income") {
      const skip = session.applyCommand({
        command_id: `skip_${guard}`,
        player_id: faction,
        type: "end_phase",
        payload: {},
      });
      if (skip.result_type !== "ok" || stamp === `${faction}|${session.state.current_phase}|${session.state.turn_number}|${session.state.game_round}`) {
        break;
      }
      continue;
    }
    const difficulty: AIDifficulty = teamOf(session, faction) === "axis" ? v2 : "EASY";
    const enemyBefore = unitValue(session, faction, false);
    const plan = planTurn(session.state, {
      difficulty,
      seed: plannerSeed(request.seed, session.state.game_round, faction),
    });
    turnMs.push(plan.elapsedMs);
    for (const command of plan.commands) {
      const result = session.applyCommand({
        command_id: command.command_id,
        player_id: command.player_id,
        type: command.type,
        payload: command.payload,
      });
      if (result.result_type === "ok" && command.type === "purchase_units") {
        noteIndustry(io, faction).spent += spendOf(session, command.payload);
      }
      if (result.result_type !== "ok" && command.type !== "end_phase" && command.type !== "end_turn") {
        continue;
      }
      if (result.result_type !== "ok") {
        break;
      }
    }
    const destroyed = enemyBefore - unitValue(session, faction, false);
    if (destroyed > 0) {
      noteIndustry(io, faction).destroyed += destroyed;
    }
    for (const [id, prior] of capitals) {
      const owner = session.state.regions[id]?.owner_faction_id ?? "";
      if (prior !== "" && owner !== prior) {
        capitalCaptures += 1;
        capitals.set(id, owner);
      }
    }
    for (const [id, prior] of cityOwners) {
      const owner = session.state.regions[id]?.owner_faction_id ?? "";
      if (owner !== prior) {
        victoryCityCaptures += 1;
        cityOwners.set(id, owner);
      }
    }
    const now = `${session.state.current_faction_id}|${session.state.current_phase}|${session.state.turn_number}|${session.state.game_round}`;
    if (now === stamp) {
      break;
    }
  }
  let blocInvasions = 0;
  for (const [id, prior] of blocs) {
    const owner = session.state.regions[id]?.owner_faction_id ?? "";
    if (owner !== prior) {
      blocInvasions += 1;
    }
  }
  const scored = objectives(session);
  const winner = session.state.winner_faction_id || "";
  return {
    seed: request.seed,
    scenario: request.scenario,
    winner,
    winnerTeam: winner === "" ? "" : teamOf(session, winner),
    winReason: winReason(session),
    rounds: session.state.game_round,
    turnMs,
    capitalCaptures,
    victoryCityCaptures,
    io,
    objectivesCompleted: scored.completed,
    objectivesPossible: scored.possible,
    blocInvasions,
  };
}

export function summarizeScenario(games: readonly ScenarioGame[]): ScenarioReport {
  let axisWins = 0;
  let alliesWins = 0;
  let draws = 0;
  let victoryCities = 0;
  let capitalCaptures = 0;
  let rounds = 0;
  let turnMs = 0;
  let turnCount = 0;
  let objectiveRate = 0;
  let objectiveGames = 0;
  let blocInvasions = 0;
  const spent = new Map<string, number>();
  const destroyed = new Map<string, number>();
  for (const game of games) {
    rounds += game.rounds;
    blocInvasions += game.blocInvasions;
    if (game.winnerTeam === "axis") {
      axisWins += 1;
    } else if (game.winnerTeam === "allies") {
      alliesWins += 1;
    } else {
      draws += 1;
    }
    if (game.winReason === "victory_cities") {
      victoryCities += 1;
    } else if (game.winReason === "capital_capture") {
      capitalCaptures += 1;
    }
    for (const ms of game.turnMs) {
      turnMs += ms;
      turnCount += 1;
    }
    if (game.objectivesPossible > 0) {
      objectiveRate += game.objectivesCompleted / game.objectivesPossible;
      objectiveGames += 1;
    }
    for (const [factionId, row] of Object.entries(game.io)) {
      spent.set(factionId, (spent.get(factionId) ?? 0) + row.spent);
      destroyed.set(factionId, (destroyed.get(factionId) ?? 0) + row.destroyed);
    }
  }
  const ioEfficiency: Record<string, number> = {};
  for (const [factionId, paid] of spent) {
    ioEfficiency[factionId] = paid > 0 ? (destroyed.get(factionId) ?? 0) / paid : 0;
  }
  const gamesPlayed = games.length;
  return {
    games: gamesPlayed,
    axisWins,
    alliesWins,
    draws,
    axisWinPercent: gamesPlayed === 0 ? 0 : (axisWins / gamesPlayed) * 100,
    alliesWinPercent: gamesPlayed === 0 ? 0 : (alliesWins / gamesPlayed) * 100,
    wins: { victoryCities, capitalCaptures },
    averageRounds: gamesPlayed === 0 ? 0 : rounds / gamesPlayed,
    averageTurnMs: turnCount === 0 ? 0 : turnMs / turnCount,
    ioEfficiency,
    nationalObjectiveCompletionRate: objectiveGames === 0 ? 0 : objectiveRate / objectiveGames,
    neutralBlocInvasionFrequency: gamesPlayed === 0 ? 0 : blocInvasions / gamesPlayed,
  };
}
