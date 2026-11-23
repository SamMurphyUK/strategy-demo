import { Command, CommandType } from "../engine/model/command";
import type { GameState } from "../engine/model/game_state";
import { Ruleset } from "../engine/rules/ruleset";
import { battleOdds } from "./battleOddsSim";
import { beamSearch } from "./beamSearchPlanner";
import { combatCandidates } from "./combatMoveGen";
import { planNonCombat } from "./nonCombatPlanner";
import { planPurchase } from "./purchasePlanner";
import { threatMap } from "./threatMap";
import { AI_DIFFICULTY_PROFILES, personaFor, type AIDifficulty, type GameCommand, type TurnPlanResult } from "./types/aiTypes";
import { validateCommand } from "./validateCommand";

export interface PlanRequest {
  difficulty?: AIDifficulty;
  seed?: number;
}

function issue(state: GameState, phase: string, type: string, payload: Record<string, unknown>, serial: number): GameCommand | null {
  const previous = state.current_phase;
  state.current_phase = phase;
  const command = Command.fromDict({
    command_id: `ai_${String(serial).padStart(3, "0")}`,
    player_id: state.current_faction_id,
    type,
    payload,
  });
  const check = validateCommand(state, command);
  state.current_phase = previous;
  return check.ok ? command : null;
}

/**
 * Reverse-order plan, forward-order commands.
 * Combat is scored first. The purchase is chosen from that picture, then emitted
 * before the moves, because purchase happens first in the turn.
 */
export function planTurn(state: GameState, request: PlanRequest = {}): TurnPlanResult {
  const started = Date.now();
  const profile = AI_DIFFICULTY_PROFILES[request.difficulty ?? "NORMAL"];
  const seed = request.seed ?? 1;
  const factionId = state.current_faction_id;
  const weights = personaFor(factionId);
  const ruleset = new Ruleset();
  ruleset.syncFromState(state);
  const phase = state.current_phase;
  const commands: GameCommand[] = [];
  let serial = 1;
  const push = (next: GameCommand | null) => {
    if (next != null) {
      commands.push(next);
      serial += 1;
    }
  };

  if (phase === "collect_income") {
    push(issue(state, "collect_income", CommandType.END_TURN, {}, serial));
    return { commands, evaluatedPlans: 0, expectedScoreDelta: 0, elapsedMs: Date.now() - started };
  }
  if (phase !== "purchase") {
    push(issue(state, phase, CommandType.END_PHASE, {}, serial));
    return { commands, evaluatedPlans: 0, expectedScoreDelta: 0, elapsedMs: Date.now() - started };
  }

  const tiles = threatMap(state, factionId, profile.enableStrategicStaging);
  let searched: ReturnType<typeof beamSearch>;
  let quiet: ReturnType<typeof planNonCombat>;
  try {
    state.current_phase = "combat_move";
    const candidates = combatCandidates(state, factionId, ruleset, profile, weights, tiles, seed);
    searched = beamSearch(state, factionId, candidates, tiles, profile, weights, seed);
    state.current_phase = "noncombat_move";
    quiet = planNonCombat(state, factionId, ruleset, searched.best.attacks, profile.enableStrategicStaging);
  } finally {
    state.current_phase = phase;
  }

  const shop = planPurchase(state, factionId, weights, tiles);
  if (shop.purchases.length > 0 || shop.repairs.length > 0) {
    push(
      issue(state, "purchase", CommandType.PURCHASE_UNITS, { purchases: shop.purchases, repairs: shop.repairs }, serial),
    );
  }
  push(issue(state, "purchase", CommandType.END_PHASE, {}, serial));
  for (const attack of searched.best.attacks) {
    push(
      issue(
        state,
        "combat_move",
        CommandType.MOVE_UNITS,
        {
          moves: [
            {
              from_region_id: attack.from,
              to_region_id: attack.to,
              units: [{ unit_type_id: attack.unitType, count: attack.count }],
            },
          ],
        },
        serial,
      ),
    );
  }
  push(issue(state, "combat_move", CommandType.END_PHASE, {}, serial));
  push(issue(state, "combat", CommandType.END_PHASE, {}, serial));
  for (const move of quiet.moves) {
    push(
      issue(
        state,
        "noncombat_move",
        CommandType.MOVE_UNITS,
        {
          moves: [
            {
              from_region_id: move.from,
              to_region_id: move.to,
              units: [{ unit_type_id: move.unitType, count: move.count }],
            },
          ],
        },
        serial,
      ),
    );
  }
  for (const load of quiet.loads) {
    push(
      issue(
        state,
        "noncombat_move",
        CommandType.LOAD_TRANSPORT,
        {
          transport_instance_id: load.transportId,
          from_region_id: load.from,
          units: [{ unit_type_id: load.unitType, count: load.count }],
        },
        serial,
      ),
    );
  }
  push(issue(state, "noncombat_move", CommandType.END_PHASE, {}, serial));
  const factory = Object.values(state.regions).find((region) => region.has_factory && region.owner_faction_id === factionId);
  if (factory != null && shop.purchases.length > 0) {
    push(
      issue(
        state,
        "mobilize",
        CommandType.PLACE_UNITS,
        {
          placements: [
            {
              region_id: factory.id,
              units: shop.purchases.map((line) => ({ unit_type_id: line.unit_type_id, count: line.count })),
            },
          ],
        },
        serial,
      ),
    );
  }
  push(issue(state, "mobilize", CommandType.END_PHASE, {}, serial));
  push(issue(state, "collect_income", CommandType.END_TURN, {}, serial));

  let expected = searched.best.score;
  if (searched.best.attacks.length > 0) {
    const first = searched.best.attacks[0];
    const deep = battleOdds(state, factionId, first.from, first.to, profile.deepOddsIterations, seed + 50);
    expected = deep.win * Math.max(1, first.value) * weights.objectiveWeight;
  }
  return {
    commands,
    evaluatedPlans: searched.evaluated,
    expectedScoreDelta: expected,
    elapsedMs: Date.now() - started,
  };
}
