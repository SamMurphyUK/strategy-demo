import { Command, CommandType } from "../engine/model/command";
import type { GameState } from "../engine/model/game_state";
import { Ruleset } from "../engine/rules/ruleset";
import { beamSearch } from "./beamSearchPlanner";
import { combatCandidates, type AttackPackage } from "./combatMoveGen";
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
    quiet = planNonCombat(state, factionId, ruleset, searched.best.attacks, profile.enableStrategicStaging, tiles);
  } finally {
    state.current_phase = phase;
  }

  const shop = planPurchase(state, factionId, weights, tiles);
  const purchasePayload: Record<string, unknown> = {};
  if (shop.purchases.length > 0) {
    purchasePayload.purchases = shop.purchases;
  }
  if (shop.repairs.length > 0) {
    purchasePayload.repairs = shop.repairs;
  }
  if (shop.research.length > 0) {
    purchasePayload.research = shop.research;
  }
  const send = (phase: string, type: string, payload: Record<string, unknown>) => {
    push(issue(state, phase, type, payload, serial));
  };
  if (Object.keys(purchasePayload).length > 0) {
    send("purchase", CommandType.PURCHASE_UNITS, purchasePayload);
  }
  send("purchase", CommandType.END_PHASE, {});
  for (const attack of searched.best.attacks) {
    emitAttack(attack, send);
  }
  send("combat_move", CommandType.END_PHASE, {});
  for (const attack of searched.best.attacks) {
    if (attack.kind !== "strategic_bomb") {
      continue;
    }
    const escorts = attack.stacks.filter((line) => line.isEscort).reduce((sum, line) => sum + line.count, 0);
    const stationed = attack.stacks.some((line) => line.from === attack.to && !line.isEscort);
    if (!stationed) {
      continue;
    }
    send("combat", CommandType.STRATEGIC_BOMB, { region_id: attack.to, escorts, facility: "factory" });
  }
  send("combat", CommandType.END_PHASE, {});
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
              units: [
                {
                  unit_type_id: move.unitType,
                  count: move.count,
                  ...(move.instanceId != null && move.instanceId !== "" ? { instance_id: move.instanceId } : {}),
                },
              ],
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
  send("noncombat_move", CommandType.END_PHASE, quiet.patrols.length > 0 ? { patrols: quiet.patrols } : {});
  if (shop.placements.length > 0) {
    send("mobilize", CommandType.PLACE_UNITS, { placements: shop.placements });
  }
  send("mobilize", CommandType.END_PHASE, {});
  send("collect_income", CommandType.END_TURN, {});

  return {
    commands,
    evaluatedPlans: searched.evaluated,
    expectedScoreDelta: searched.best.score,
    elapsedMs: Date.now() - started,
  };
}

function emitAttack(attack: AttackPackage, send: (phase: string, type: string, payload: Record<string, unknown>) => void): void {
  if (attack.kind === "naval_raid") {
    return;
  }
  if (attack.kind === "amphibious" && attack.transportId != null && attack.originSea != null) {
    send("combat_move", CommandType.DESIGNATE_AMPHIBIOUS, {
      transport_instance_id: attack.transportId,
      origin_sea_zone_id: attack.originSea,
      target_region_id: attack.to,
    });
    return;
  }
  const grouped = new Map<string, { unit_type_id: string; count: number }[]>();
  for (const line of attack.stacks) {
    if (line.from === attack.to) {
      continue;
    }
    const rows = grouped.get(line.from) ?? [];
    rows.push({ unit_type_id: line.unitType, count: line.count });
    grouped.set(line.from, rows);
  }
  for (const [from, units] of grouped) {
    send("combat_move", CommandType.MOVE_UNITS, {
      moves: [{ from_region_id: from, to_region_id: attack.to, units }],
    });
  }
}
