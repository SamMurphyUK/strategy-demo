import { describe, expect, it } from "vitest";
import { Faction, GameSession, GameState, Region, Unit } from "../src/engine";
import { combatCandidates } from "../src/ai/combatMoveGen";
import { planAITurn } from "../src/ai/planAITurn";
import { planPurchase } from "../src/ai/purchasePlanner";
import { threatMap } from "../src/ai/threatMap";
import { AI_DIFFICULTY_PROFILES, personaFor } from "../src/ai/types/aiTypes";
import { validateCommand } from "../src/ai/validateCommand";
import { MovementValidator } from "../src/engine/movement/movement_validator";
import { Ruleset } from "../src/engine/rules/ruleset";
import { classifyUnit } from "../src/engine/types/ruleset";

function piece(id: string, category: string, attack: number, defense: number, movement: number, cost: number): Unit {
  return Unit.fromDict({ id, name: id, category, attack, defense, movement, cost });
}

function land(id: string, owner: string, ipc: number, extra: Record<string, unknown> = {}): Region {
  return Region.fromDict({ id, name: id, type: "land", ipc_value: ipc, owner_faction_id: owner, ...extra });
}

function camp(): GameState {
  const state = new GameState();
  state.factions.ger = Faction.fromDict({ id: "ger", name: "Germany", color: "#444", starting_ipc: 24, team: "axis" });
  state.factions.uk = Faction.fromDict({ id: "uk", name: "Britain", color: "#124", starting_ipc: 18, team: "allies" });
  state.ipc.ger = 24;
  state.ipc.uk = 18;
  state.turn_order = ["ger", "uk"];
  state.current_faction_id = "ger";
  state.current_phase = "purchase";
  state.game_round = 3;
  state.unit_types.infantry = piece("infantry", "land", 1, 2, 1, 3);
  state.unit_types.artillery = piece("artillery", "land", 2, 2, 1, 4);
  state.unit_types.tank = piece("tank", "land", 3, 3, 2, 6);
  state.unit_types.fighter = piece("fighter", "air", 3, 4, 4, 10);
  state.unit_types.transport = piece("transport", "sea", 0, 0, 2, 7);
  state.regions.berlin = land("berlin", "ger", 8, { is_capital: true, has_factory: true });
  state.regions.london = land("london", "uk", 6, { is_capital: true, has_factory: true });
  state.regions.dock = Region.fromDict({ id: "dock", name: "Dock", type: "sea", owner_faction_id: "" });
  state.adjacency.berlin = ["london", "dock"];
  state.adjacency.london = ["berlin"];
  state.adjacency.dock = ["berlin"];
  state.region_units.berlin = [
    { faction_id: "ger", unit_type_id: "infantry", count: 4 },
    { faction_id: "ger", unit_type_id: "fighter", count: 1 },
  ];
  state.region_units.london = [{ faction_id: "uk", unit_type_id: "infantry", count: 4 }];
  state.region_units.dock = [{ faction_id: "ger", unit_type_id: "transport", count: 1, instance_id: "t1" }];
  state.transport_instances.t1 = { instance_id: "t1", unit_type_id: "transport", region_id: "dock", cargo: [] };
  return state;
}

function spend(state: GameState, payload: Record<string, unknown>): number {
  let total = 0;
  const purchases: unknown[] = Array.isArray(payload.purchases) ? payload.purchases : [];
  for (const line of purchases) {
    if (line == null || typeof line !== "object") {
      continue;
    }
    const row = line as Record<string, unknown>;
    total += Math.max(0, Math.trunc(Number(row.count ?? 0))) * Math.max(0, state.unit_types[String(row.unit_type_id ?? "")]?.cost ?? 0);
  }
  return total;
}

function loadedBesideHostile(state: GameState): boolean {
  for (const transport of Object.values(state.transport_instances)) {
    const cargo = (transport.cargo ?? []).reduce((sum, line) => sum + Math.max(0, Math.trunc(Number(line.count ?? 0))), 0);
    if (cargo <= 0) {
      continue;
    }
    const sea = String(transport.region_id ?? "");
    for (const regionId of state.getAdjacentRegions(sea)) {
      const region = state.regions[regionId];
      if (region?.isLandRegion() === true && state.isRegionHostileTo(regionId, state.current_faction_id)) {
        return true;
      }
    }
  }
  return false;
}

describe("planner acceptance", () => {
  it("keeps 20 turns legal, funded, and clear of stranded air and loaded transports", () => {
    const session = new GameSession();
    session.bindArena(camp(), 11);
    const ruleset = new Ruleset();
    const validator = new MovementValidator();
    for (let turn = 0; turn < 20; turn += 1) {
      const state = session.state;
      ruleset.syncFromState(state);
      const faction = state.current_faction_id;
      const treasury = Math.max(0, Math.trunc(state.ipc[faction] ?? 0));
      const plan = planAITurn(state, faction, "EASY", 11);
      for (const command of plan.commands) {
        const check = validateCommand(state, command);
        expect(check.ok, check.message).toBe(true);
        if (command.type === "purchase_units") {
          expect(spend(state, command.payload)).toBeLessThanOrEqual(treasury);
        }
        if (command.type === "move_units") {
          const moves: unknown[] = Array.isArray(command.payload.moves) ? command.payload.moves : [];
          for (const move of moves) {
            if (move == null || typeof move !== "object") {
              continue;
            }
            const row = move as Record<string, unknown>;
            const units: unknown[] = Array.isArray(row.units) ? row.units : [];
            for (const unit of units) {
              if (unit == null || typeof unit !== "object") {
                continue;
              }
              const line = unit as Record<string, unknown>;
              const unitType = String(line.unit_type_id ?? "");
              if (state.unit_types[unitType]?.category !== "air") {
                continue;
              }
              const result = validator.validateStackMove(
                String(row.from_region_id ?? ""),
                String(row.to_region_id ?? ""),
                unitType,
                command.player_id,
                Math.max(1, Math.trunc(Number(line.count ?? 1))),
                state,
                ruleset,
              );
              expect(result.ok, result.errors.map((error) => error.message).join(" ")).toBe(true);
            }
          }
        }
        const applied = session.applyCommand({
          command_id: `${command.command_id}_${turn}`,
          player_id: command.player_id,
          type: command.type,
          payload: command.payload,
        });
        expect(applied.result_type, applied.error?.message ?? command.type).toBe("ok");
        expect(session.state.ipc[faction] ?? 0).toBeGreaterThanOrEqual(0);
      }
      expect(loadedBesideHostile(session.state)).toBe(false);
    }
  });

  it("trades one or two infantry into a dead zone instead of armor", () => {
    const state = new GameState();
    state.factions.ger = Faction.fromDict({ id: "ger", name: "Germany", color: "#444", starting_ipc: 20, team: "axis" });
    state.factions.uk = Faction.fromDict({ id: "uk", name: "Britain", color: "#124", starting_ipc: 10, team: "allies" });
    state.current_faction_id = "ger";
    state.current_phase = "purchase";
    state.ipc.ger = 12;
    state.unit_types.infantry = piece("infantry", "land", 1, 2, 1, 3);
    state.unit_types.tank = piece("tank", "land", 3, 3, 1, 6);
    state.regions.home = land("home", "ger", 4, { has_factory: true });
    state.regions.border = land("border", "uk", 1);
    state.regions.flank = land("flank", "uk", 1);
    state.adjacency.home = ["border"];
    state.adjacency.border = ["home", "flank"];
    state.adjacency.flank = ["border"];
    state.region_units.home = [
      { faction_id: "ger", unit_type_id: "infantry", count: 4 },
      { faction_id: "ger", unit_type_id: "tank", count: 2 },
    ];
    state.region_units.flank = [{ faction_id: "uk", unit_type_id: "tank", count: 6 }];
    const plan = planAITurn(state, "ger", "HARD", 4);
    const infantry = plan.commands.filter((command) => command.type === "move_units");
    expect(infantry.length).toBeGreaterThan(0);
    for (const command of plan.commands) {
      const moves: unknown[] = Array.isArray(command.payload.moves) ? command.payload.moves : [];
      for (const move of moves) {
        if (move == null || typeof move !== "object") {
          continue;
        }
        const row = move as Record<string, unknown>;
        if (String(row.to_region_id ?? "") !== "border") {
          continue;
        }
        const units: unknown[] = Array.isArray(row.units) ? row.units : [];
        for (const unit of units) {
          const line = unit as Record<string, unknown>;
          expect(classifyUnit(String(line.unit_type_id ?? ""))).toBe("INFANTRY");
          const count = Math.trunc(Number(line.count ?? 0));
          expect(count).toBeGreaterThanOrEqual(1);
          expect(count).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it("spends at least 80 percent of the treasury on the capital when capture odds exceed half", () => {
    const state = new GameState();
    state.factions.ger = Faction.fromDict({ id: "ger", name: "Germany", color: "#444", starting_ipc: 30, team: "axis" });
    state.factions.uk = Faction.fromDict({ id: "uk", name: "Britain", color: "#124", starting_ipc: 10, team: "allies" });
    state.current_faction_id = "ger";
    state.current_phase = "purchase";
    state.ipc.ger = 30;
    state.unit_types.infantry = piece("infantry", "land", 1, 2, 1, 3);
    state.unit_types.artillery = piece("artillery", "land", 2, 2, 1, 4);
    state.unit_types.tank = piece("tank", "land", 3, 3, 2, 6);
    state.regions.capital = land("capital", "ger", 10, { is_capital: true, has_factory: true });
    state.regions.gate = land("gate", "uk", 2);
    state.adjacency.capital = ["gate"];
    state.adjacency.gate = ["capital"];
    state.region_units.capital = [{ faction_id: "ger", unit_type_id: "infantry", count: 2 }];
    state.region_units.gate = [{ faction_id: "uk", unit_type_id: "tank", count: 4 }];
    const shop = planPurchase(state, "ger", personaFor("ger"), threatMap(state, "ger", false));
    let defense = 0;
    for (const line of shop.purchases) {
      const kind = classifyUnit(line.unit_type_id);
      if (kind === "INFANTRY" || kind === "ARTILLERY") {
        defense += line.count * (state.unit_types[line.unit_type_id]?.cost ?? 0);
      }
    }
    expect(defense / 30).toBeGreaterThanOrEqual(0.8);
    expect(shop.placements.every((placement) => placement.region_id === "capital")).toBe(true);
  });

  it("assigns artillery or heavy bombers to suppress an urban garrison", () => {
    const state = new GameState();
    state.factions.ger = Faction.fromDict({ id: "ger", name: "Germany", color: "#444", starting_ipc: 20, team: "axis" });
    state.factions.uk = Faction.fromDict({ id: "uk", name: "Britain", color: "#124", starting_ipc: 10, team: "allies" });
    state.current_faction_id = "ger";
    state.current_phase = "combat_move";
    state.rulesetConfig.terrainModifiers = true;
    state.rulesetConfig.preparatoryBombardment = true;
    state.unit_types.infantry = piece("infantry", "land", 1, 2, 1, 3);
    state.unit_types.artillery = piece("artillery", "land", 2, 2, 1, 4);
    state.unit_types.strategic_bomber = piece("strategic_bomber", "air", 4, 1, 6, 12);
    state.regions.home = land("home", "ger", 3);
    state.regions.city = land("city", "uk", 3, { land_cover: "URBAN" });
    state.adjacency.home = ["city"];
    state.adjacency.city = ["home"];
    state.region_units.home = [
      { faction_id: "ger", unit_type_id: "infantry", count: 8 },
      { faction_id: "ger", unit_type_id: "artillery", count: 2 },
    ];
    state.region_units.city = [{ faction_id: "uk", unit_type_id: "infantry", count: 3 }];
    const ruleset = new Ruleset();
    ruleset.syncFromState(state);
    const packages = combatCandidates(state, "ger", ruleset, AI_DIFFICULTY_PROFILES.NORMAL, personaFor("ger"), threatMap(state, "ger", false), 3);
    const suppression = packages.filter((pack) => pack.to === "city" && pack.kind === "suppression");
    expect(suppression.length).toBeGreaterThan(0);
    expect(
      suppression.some((pack) =>
        pack.stacks.some(
          (stack) =>
            stack.assignedToSuppression === true &&
            (classifyUnit(stack.unitType) === "ARTILLERY" || classifyUnit(stack.unitType) === "HEAVY_BOMBER"),
        ),
      ),
    ).toBe(true);
  });

  it("repeats a normal mid-game turn inside 150 milliseconds", () => {
    const started = performance.now();
    const first = planAITurn(camp(), "ger", "NORMAL", 19);
    const elapsed = performance.now() - started;
    const second = planAITurn(camp(), "ger", "NORMAL", 19);
    expect(elapsed).toBeLessThan(150);
    expect(second.commands.map((command) => ({ type: command.type, player_id: command.player_id, payload: command.payload }))).toEqual(
      first.commands.map((command) => ({ type: command.type, player_id: command.player_id, payload: command.payload })),
    );
  });
});
