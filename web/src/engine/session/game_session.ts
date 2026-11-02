import { AmphibiousEngine } from "../amphibious/amphibious";
import { CombatEngine } from "../combat/combat";
import { EconomyEngine } from "../economy/economy";
import { Command, CommandType } from "../model/command";
import type { GameEvent, GameEventDict } from "../model/event";
import { GameState, type StateSnapshot } from "../model/game_state";
import type { Dict } from "../model/types";
import { MovementEngine } from "../movement/movement";
import { applyCargoCommand, applyRecordedMove } from "../movement/phase_orders";
import { assaultError, strandedCargoGate, unloadError } from "../transport/cargo_rules";
import { TransportLoadValidator } from "../transport/transport_load_validator";
import { PlacementEngine } from "../placement/placement";
import { PCG, type PcgSeed } from "../rng/pcg";
import { processEndPhase, processEndTurn, startTurn } from "../turn/phase_controllers";
import { TurnEngine } from "../turn/turn_engine";
import { type CommandError, CommandValidator } from "../validation/command_validator";
import { VictoryEngine } from "../victory/victory";
import { loadFactions, loadMap, loadSetup, loadUnits } from "./session_loaders";

export interface CommandResult {
  result_type: "ok" | "error";
  error?: CommandError;
  events: GameEventDict[];
  new_state: StateSnapshot;
}

export class GameSession {
  state!: GameState;
  rng!: PCG;
  validator!: CommandValidator;
  turnEngine!: TurnEngine;
  economy!: EconomyEngine;
  movement!: MovementEngine;
  combat!: CombatEngine;
  placement!: PlacementEngine;
  victory!: VictoryEngine;
  amphibious!: AmphibiousEngine;

  private _events: GameEvent[] = [];
  private _seq = 0;

  // -------------------------------------------------------------------
  // FACTORY
  // -------------------------------------------------------------------
  static create(
    mapData: Dict,
    unitsData: Dict,
    factionsData: Dict,
    setupData: Dict,
    rulesData: Dict,
    rngSeed: PcgSeed,
  ): GameSession {
    const s = new GameSession();
    s.initSession(mapData, unitsData, factionsData, setupData, rulesData, rngSeed);
    return s;
  }

  // -------------------------------------------------------------------
  // INITIALIZATION
  // -------------------------------------------------------------------
  private initSession(
    mapData: Dict,
    unitsData: Dict,
    factionsData: Dict,
    setupData: Dict,
    rulesData: Dict,
    rngSeed: PcgSeed,
  ): void {
    this.state = new GameState();
    this.rng = PCG.fromSeed(rngSeed);

    loadUnits(this.state, unitsData);
    loadFactions(this.state, factionsData);
    loadMap(this.state, mapData);
    loadSetup(this.state, setupData);

    this.state.rules = rulesData;

    this.validator = new CommandValidator(this.state);
    this.turnEngine = new TurnEngine(this.state);
    this.economy = new EconomyEngine(this.state);
    this.movement = new MovementEngine(this.state);
    this.combat = new CombatEngine(this.state, this.rng);
    this.placement = new PlacementEngine(this.state);
    this.victory = new VictoryEngine(this.state);
    this.amphibious = new AmphibiousEngine(this.state);

    this.append(this.syncSeq(startTurn(this.turnEngine)));
  }

  // -------------------------------------------------------------------
  // COMMAND APPLICATION
  // -------------------------------------------------------------------
  applyCommand(cmdDict: Dict): CommandResult {
    const cmd = Command.fromDict(cmdDict);

    if (!this.validator.validate(cmd)) {
      return {
        result_type: "error",
        error: this.validator.getError(),
        events: [],
        new_state: this.state.toSnapshot(),
      };
    }

    let events: GameEvent[] = [];
    const sync = (evts: GameEvent[]) => this.syncSeq(evts);

    switch (cmd.type) {
      case CommandType.PURCHASE_UNITS:
        events = this.syncSeq(this.economy.processPurchase(cmd));
        break;

      case CommandType.MOVE_UNITS:
        events = this.syncSeq(applyRecordedMove(this.state, cmd, this.movement));
        break;

      case CommandType.LOAD_TRANSPORT: {
        const load = new TransportLoadValidator().validateLoad(
          String(cmd.payload.transport_instance_id ?? ""),
          String(cmd.payload.from_region_id ?? ""),
          cmd.payload.units ?? [],
          cmd.player_id,
          this.state,
        );
        if (!load.ok) {
          return {
            result_type: "error",
            error: { code: "LOAD_INVALID", message: load.errors[0]?.message ?? "Cannot load units onto transport" },
            events: [],
            new_state: this.state.toSnapshot(),
          };
        }
        events = this.syncSeq(applyCargoCommand(this.state, cmd, this.movement, this.amphibious));
        break;
      }

      case CommandType.UNLOAD_TRANSPORT: {
        const unload = unloadError(
          this.state,
          cmd.player_id,
          String(cmd.payload.transport_instance_id ?? ""),
          String(cmd.payload.to_region_id ?? ""),
          cmd.payload.units ?? [],
        );
        if (unload != null) {
          return {
            result_type: "error",
            error: { code: "UNLOAD_INVALID", message: unload },
            events: [],
            new_state: this.state.toSnapshot(),
          };
        }
        events = this.syncSeq(applyCargoCommand(this.state, cmd, this.movement, this.amphibious));
        break;
      }

      case CommandType.DESIGNATE_AMPHIBIOUS: {
        const assault = assaultError(
          this.state,
          cmd.player_id,
          String(cmd.payload.transport_instance_id ?? ""),
          String(cmd.payload.origin_sea_zone_id ?? ""),
          String(cmd.payload.target_region_id ?? ""),
        );
        if (assault != null) {
          return {
            result_type: "error",
            error: { code: "AMPHIBIOUS_INVALID", message: assault },
            events: [],
            new_state: this.state.toSnapshot(),
          };
        }
        events = this.syncSeq(applyCargoCommand(this.state, cmd, this.movement, this.amphibious));
        break;
      }

      case CommandType.PLACE_UNITS:
        events = this.syncSeq(this.placement.processPlacement(cmd));
        break;

      case CommandType.END_PHASE: {
        if (this.state.current_phase === "combat_move") {
          const cargo = strandedCargoGate(this.state);
          if (!cargo.advance) {
            return {
              result_type: "error",
              error: { code: "CARGO_STRANDED", message: cargo.warning },
              events: [],
              new_state: this.state.toSnapshot(),
            };
          }
        }
        events = processEndPhase(
          this.state.current_phase,
          this.state,
          this.turnEngine,
          this.amphibious,
          this.combat,
          this.placement,
          sync,
        );
        break;
      }

      case CommandType.END_TURN:
        events = processEndTurn(
          cmd.player_id,
          this.state.current_phase,
          this.state,
          this.economy,
          this.victory,
          this.turnEngine,
          sync,
        );
        break;

      case CommandType.START_BATTLE:
      case CommandType.BATTLE_ROLL:
      case CommandType.BATTLE_CASUALTIES:
      case CommandType.BATTLE_RETREAT: {
        const battle = this.combat.applyBattleCommand(cmd.type, cmd.player_id, cmd.payload);
        if (battle != null && !battle.ok) {
          return { result_type: "error", error: battle.error, events: [], new_state: this.state.toSnapshot() };
        }
        events = this.syncSeq(battle?.ok ? battle.events : []);
        break;
      }
    }

    this.append(events);

    return {
      result_type: "ok",
      events: events.map((e) => e.toDict()),
      new_state: this.state.toSnapshot(),
    };
  }

  // -------------------------------------------------------------------
  // QUERY HELPERS
  // -------------------------------------------------------------------
  getState(): StateSnapshot {
    return this.state.toSnapshot();
  }

  getEventsSince(seq: number): GameEventDict[] {
    return this._events.filter((e) => e.sequence > seq).map((e) => e.toDict());
  }

  getLegalCommands(player: string): string[] {
    if (player !== this.state.current_faction_id) {
      return [];
    }
    switch (this.state.current_phase) {
      case "purchase":
        return ["purchase_units", "end_phase"];
      case "combat_move":
        return ["move_units", "load_transport", "unload_transport", "designate_amphibious", "end_phase"];
      case "combat":
        return [];
      case "noncombat_move":
        return ["move_units", "load_transport", "unload_transport", "end_phase"];
      case "mobilize":
        return ["place_units", "end_phase"];
      case "collect_income":
        return ["end_turn"];
    }
    return [];
  }

  // -------------------------------------------------------------------
  // INTERNAL HELPERS
  // -------------------------------------------------------------------
  private syncSeq(events: GameEvent[]): GameEvent[] {
    for (const e of events) {
      if (e.sequence > this._seq) {
        this._seq = e.sequence;
      }
    }
    this.turnEngine.setSequence(this._seq);
    this.economy.setSequence(this._seq);
    this.movement.setSequence(this._seq);
    this.combat.setSequence(this._seq);
    this.placement.setSequence(this._seq);
    this.victory.setSequence(this._seq);
    this.amphibious.setSequence(this._seq);
    return events;
  }

  private append(events: GameEvent[]): void {
    this._events.push(...events);
  }
}
