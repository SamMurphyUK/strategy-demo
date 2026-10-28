import {
  buildFactionsData,
  buildMapData,
  buildSetupData,
  NEWMAP_PATH,
  RULES_PATH,
  UNITS_PATH,
} from "../../content/game_scene_session_builder";
import { AmphibiousEngine } from "../amphibious/amphibious";
import { type Battle, CombatEngine } from "../combat/combat";
import { loadJson } from "../content/res";
import { EconomyEngine } from "../economy/economy";
import { Command, CommandType } from "../model/command";
import { GameEvent, GameEventType } from "../model/event";
import { GameState, type StateSnapshot } from "../model/game_state";
import { type Dict, deepCopy, isDict, type PurchaseLine } from "../model/types";
import { MovementEngine } from "../movement/movement";
import { MovementValidator } from "../movement/movement_validator";
import { PlacementEngine } from "../placement/placement";
import { RegionUnitDisplay } from "../presentation/region_unit_display";
import { PCG, type PcgSeed } from "../rng/pcg";
import { Ruleset } from "../rules/ruleset";
import { TransportLoadValidator } from "../transport/transport_load_validator";
import { processEndPhase, purchaseResult, startTurn } from "../turn/phase_controllers";
import { TurnEngine } from "../turn/turn_engine";
import { CommandValidator } from "../validation/command_validator";
import { EventSchemaValidator } from "../validation/event_schema_validator";
import type { ValidationResult } from "../validation/validation_types";
import { VictoryEngine } from "../victory/victory";
import { loadFactions, loadMap, loadSetup, loadUnits } from "./session_loaders";

export const UNIT_COSTS: Record<string, number> = {
  infantry: 3,
  artillery: 4,
  tank: 6,
  transport: 7,
  battleship: 20,
};

/** Canonical stub event: underscores stripped from event_id and type. */
export interface CanonicalEvent {
  event_id: string;
  sequence: number;
  type: string;
  payload: Dict;
  source_command_id: string;
  timestamp: number;
}

export interface StubResult {
  result_type: "ok" | "error";
  error?: { code: string; message: string };
  events: CanonicalEvent[];
}

export interface StubStateSnapshot extends StateSnapshot {
  gameover: boolean;
  cost_table: Record<string, number>;
  applied_event_ids: string[];
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

export class GameSessionStub {
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
  ruleset: Ruleset | null = null;

  debug = false;

  private _events: CanonicalEvent[] = [];
  private _seq = 0;
  private _appliedEventIds: Record<string, boolean> = {};
  private _commandResults: Record<string, StubResult> = {};
  private _demoSeed = 12345;
  private _fixedTimestamp = 0;

  initializeDemo(seed = 12345): void {
    this._demoSeed = seed;
    this._fixedTimestamp = 1680000000;
    const mapJson = loadJson(NEWMAP_PATH);
    this.initSession(
      buildMapData(mapJson),
      loadJson(UNITS_PATH),
      buildFactionsData(),
      buildSetupData(mapJson),
      loadJson(RULES_PATH),
      { state: seed, sequence: 1 },
    );
  }

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
    this._seq = Math.trunc(Number(rngSeed.sequence ?? 1)) - 1;

    loadUnits(this.state, unitsData);
    loadFactions(this.state, factionsData);
    loadMap(this.state, mapData);
    loadSetup(this.state, setupData);
    this.state.rules = rulesData;
    this.ruleset = new Ruleset();
    this.ruleset.syncFromState(this.state);

    this.validator = new CommandValidator(this.state);
    this.turnEngine = new TurnEngine(this.state);
    this.economy = new EconomyEngine(this.state);
    this.movement = new MovementEngine(this.state);
    this.combat = new CombatEngine(this.state, this.rng);
    this.placement = new PlacementEngine(this.state);
    this.victory = new VictoryEngine(this.state);
    this.amphibious = new AmphibiousEngine(this.state);

    this.recordEvents(this.syncSeq(startTurn(this.turnEngine)), "");
  }

  applyCommand(cmdDict: Dict): StubResult {
    const commandId = String(cmdDict.command_id ?? "");
    if (commandId !== "" && commandId in this._commandResults) {
      return deepCopy(this._commandResults[commandId]);
    }

    const typeStr = String(cmdDict.type ?? "").toLowerCase();
    const result = typeStr === "collect_income" ? this.applyCollectIncome(cmdDict) : this.applyGameCommand(cmdDict);

    if (commandId !== "") {
      this._commandResults[commandId] = deepCopy(result);
    }
    return result;
  }

  private applyGameCommand(cmdDict: Dict): StubResult {
    const cmd = Command.fromDict(cmdDict);
    if (!this.validator.validate(cmd)) {
      return { result_type: "error", error: this.validator.getError(), events: [] };
    }

    let events: Array<GameEvent | Dict> = [];
    const sourceId = String(cmdDict.command_id ?? "");

    switch (cmd.type) {
      case CommandType.PURCHASE_UNITS: {
        const affordError = this.validatePurchaseAffordability(cmd);
        if (affordError) {
          return affordError;
        }
        const existingPending: PurchaseLine[] = deepCopy(this.state.pending_purchases[cmd.player_id] ?? []);
        const purchase = purchaseResult(this.economy.processPurchase(cmd));
        if (!purchase.success) {
          return this.purchaseFailureResult(purchase, sourceId);
        }
        let newLines: Dict[] = cmd.payload.purchases ?? [];
        if (newLines.length === 0) {
          newLines = cmd.payload.units ?? [];
        }
        this.applyMergedPending(cmd.player_id, existingPending, newLines);
        events = this.syncSeq(purchase.events);
        break;
      }

      case CommandType.PLACE_UNITS: {
        const placementError = this.validatePlacementCommand(cmd);
        if (placementError) {
          return placementError;
        }
        events = this.syncSeq(this.placement.processPlacement(cmd));
        break;
      }

      case CommandType.MOVE_UNITS: {
        const moveError = this.validateMoveCommand(cmd);
        if (moveError) {
          return moveError;
        }
        events = this.syncSeq(this.movement.processMove(cmd));
        break;
      }

      case CommandType.LOAD_TRANSPORT: {
        const loadError = this.validateLoadCommand(cmd);
        if (loadError) {
          return loadError;
        }
        events = this.syncSeq(this.movement.processLoad(cmd));
        break;
      }

      case CommandType.STRATEGIC_BOMB: {
        const bombError = this.validateStrategicBomb(cmd);
        if (bombError) {
          return bombError;
        }
        events = this.syncSeq(this.processStrategicBomb(cmd));
        break;
      }

      case CommandType.END_PHASE: {
        let forfeitEvents: GameEvent[] = [];
        if (this.state.current_phase === "mobilize") {
          forfeitEvents = this.forfeitPendingAtMobilizeEnd(cmd.player_id);
        }
        const endEvents = processEndPhase(
          this.state.current_phase,
          this.state,
          this.turnEngine,
          this.amphibious,
          this.combat,
          this.placement,
          (evts) => this.syncSeq(evts),
        );
        events = [...forfeitEvents, ...endEvents];
        break;
      }

      case CommandType.END_TURN:
        return this.handleEndTurn(cmd.player_id, sourceId);

      default:
        return {
          result_type: "error",
          error: { code: "UNSUPPORTED", message: "Command not supported in demo stub" },
          events: [],
        };
    }

    const canonical = this.recordEvents(events, sourceId);
    return { result_type: "ok", events: canonical };
  }

  /** Hard-codes the two demo factions and skips TurnEngine, as GameSessionStub.gd does. */
  handleEndTurn(playerId: string, commandId: string): StubResult {
    const factions = ["allies", "axis"];
    const current = playerId.toLowerCase();
    const idx = factions.indexOf(current);
    if (idx === -1) {
      return {
        result_type: "error",
        error: { code: "INVALID_FACTION", message: `Unknown faction: ${playerId}` },
        events: [],
      };
    }

    const events: Array<GameEvent | Dict> = [];
    if (this.state.current_phase === "collect_income") {
      events.push(...this.syncSeq(this.economy.collectIncome(current)));
    }

    const nextIdx = (idx + 1) % factions.length;
    const nextFaction = factions[nextIdx];
    if (nextIdx === 0) {
      this.state.game_round += 1;
    }
    this.state.turn_number += 1;
    this.state.current_faction_id = nextFaction;
    this.state.current_phase = "purchase";
    this.state.clearMovementPhaseTracking();

    events.push(
      this.createEvent(
        "turn_ended",
        {
          faction_id: current,
          next_faction_id: nextFaction,
          new_turn_number: this.state.turn_number,
          new_round: this.state.game_round,
        },
        commandId,
      ),
    );

    const recorded = this.recordEvents(events, commandId);
    return { result_type: "ok", events: recorded };
  }

  private applyCollectIncome(cmdDict: Dict): StubResult {
    const cmd = Command.fromDict(cmdDict);
    if (cmd.player_id !== this.state.current_faction_id) {
      return { result_type: "error", error: { code: "OUT_OF_TURN", message: "Not your turn" }, events: [] };
    }
    const events = this.syncSeq(this.economy.collectIncome(cmd.player_id));
    const canonical = this.recordEvents(events, String(cmdDict.command_id ?? ""));
    return { result_type: "ok", events: canonical };
  }

  getState(): StubStateSnapshot {
    const snap = this.state.toSnapshot();
    return {
      ...snap,
      gameover: snap.game_over ?? false,
      cost_table: this.getCostTable(),
      applied_event_ids: Object.keys(this._appliedEventIds),
    };
  }

  getCostTable(): Record<string, number> {
    const table: Record<string, number> = {};
    for (const utid of Object.keys(this.state.unit_types)) {
      const ut = this.state.unit_types[utid];
      if (ut) {
        table[utid] = ut.cost;
      }
    }
    return table;
  }

  getDemoSeed(): number {
    return this._demoSeed;
  }

  getLegalCommands(playerId: string): string[] {
    if (playerId !== this.state.current_faction_id) {
      return [];
    }
    switch (this.state.current_phase) {
      case "purchase":
        return ["purchase_units", "end_phase"];
      case "combat_move":
        return ["move_units", "end_phase"];
      case "combat":
        return ["strategic_bomb", "end_phase"];
      case "noncombat_move":
        return ["move_units", "end_phase"];
      case "mobilize":
        return ["place_units", "end_phase"];
      case "collect_income":
        return ["end_turn", "collect_income"];
    }
    return [];
  }

  static validateEventShape(evt: Dict): boolean {
    if (!EventSchemaValidator.validateEvent(evt)) {
      return false;
    }
    const required = ["event_id", "sequence", "type", "payload", "source_command_id", "timestamp"];
    for (const key of required) {
      if (!(key in evt)) {
        return false;
      }
    }
    return typeof evt.type === "string" && isDict(evt.payload);
  }

  createEvent(evtType: string, payload: Dict, sourceCommandId = ""): CanonicalEvent {
    this._seq += 1;
    return {
      event_id: `e${String(this._seq).padStart(5, "0")}`,
      sequence: this._seq,
      type: this.normalizeEventType(evtType),
      payload,
      source_command_id: sourceCommandId,
      timestamp: this._fixedTimestamp > 0 ? this._fixedTimestamp : unixNow(),
    };
  }

  /** Drops events whose event_id was already applied, which hides engine sequence collisions. */
  private recordEvents(events: Array<GameEvent | Dict>, sourceCommandId: string): CanonicalEvent[] {
    const canonical: CanonicalEvent[] = [];
    for (const raw of events) {
      let evtDict: Dict;
      if (raw instanceof GameEvent) {
        evtDict = this.gameEventToCanonical(raw, sourceCommandId);
      } else if (isDict(raw)) {
        evtDict = deepCopy(raw);
        if (!("source_command_id" in evtDict)) {
          evtDict.source_command_id = sourceCommandId;
        }
        evtDict.type = this.normalizeEventType(String(evtDict.type ?? ""));
        if (!("timestamp" in evtDict)) {
          evtDict.timestamp = this._fixedTimestamp;
        }
      } else {
        continue;
      }

      if (!GameSessionStub.validateEventShape(evtDict)) {
        continue;
      }

      const eid = String(evtDict.event_id ?? "");
      if (eid in this._appliedEventIds) {
        continue;
      }
      this._appliedEventIds[eid] = true;
      this._events.push(evtDict as CanonicalEvent);
      canonical.push(evtDict as CanonicalEvent);
    }
    return canonical;
  }

  private gameEventToCanonical(evt: GameEvent, sourceCommandId: string): CanonicalEvent {
    return {
      event_id: String(evt.event_id).replaceAll("_", ""),
      sequence: evt.sequence,
      type: this.normalizeEventType(GameEvent.typeToString(evt.type)),
      payload: deepCopy(evt.payload),
      source_command_id: sourceCommandId,
      timestamp: this._fixedTimestamp > 0 ? this._fixedTimestamp : unixNow(),
    };
  }

  private normalizeEventType(typeName: string): string {
    return String(typeName).toLowerCase().replaceAll("_", "");
  }

  private syncSeq<T extends GameEvent | Dict>(events: T[]): T[] {
    for (const e of events) {
      if (e instanceof GameEvent && e.sequence > this._seq) {
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

  private validatePurchaseAffordability(cmd: Command): StubResult | null {
    let purchases: Dict[] = cmd.payload.purchases ?? [];
    if (purchases.length === 0) {
      purchases = cmd.payload.units ?? [];
    }
    let totalCost = 0;
    for (const purchase of purchases) {
      const utid = String(purchase.unit_type_id ?? "");
      const count = Math.trunc(Number(purchase.count ?? 1));
      let cost = Math.trunc(Number(UNIT_COSTS[utid] ?? 0));
      if (cost === 0) {
        const ut = this.state.unit_types[utid];
        if (ut) {
          cost = ut.cost;
        }
      }
      if (cost === 0) {
        return {
          result_type: "error",
          error: { code: "UNKNOWN_UNIT", message: `Unknown unit type: ${utid}` },
          events: [],
        };
      }
      totalCost += cost * count;
    }

    if (totalCost > (this.state.ipc[cmd.player_id] ?? 0)) {
      const failEvt = this.createEvent(
        "purchase_failed",
        { faction_id: cmd.player_id, reason: "insufficient_ipc" },
        String(cmd.command_id),
      );
      const recorded = this.recordEvents([failEvt], String(cmd.command_id));
      return {
        result_type: "error",
        error: { code: "PURCHASE_FAILED", message: "insufficient_ipc" },
        events: recorded,
      };
    }
    return null;
  }

  private purchaseFailureResult(
    purchase: { error_code: string; error_message: string; events: GameEvent[] },
    sourceCommandId: string,
  ): StubResult {
    const rawEvents = this.syncSeq(purchase.events);
    const canonical = this.recordEvents(rawEvents, sourceCommandId);
    return {
      result_type: "error",
      error: { code: purchase.error_code, message: purchase.error_message },
      events: canonical,
    };
  }

  private applyMergedPending(factionId: string, existing: PurchaseLine[], newLines: Dict[]): void {
    const merged: Record<string, number> = {};
    for (const line of [...existing, ...newLines]) {
      const utid = String(line.unit_type_id ?? "");
      merged[utid] = (merged[utid] ?? 0) + Math.trunc(Number(line.count ?? 0));
    }
    const result: PurchaseLine[] = [];
    for (const utid of Object.keys(merged)) {
      if (merged[utid] > 0) {
        result.push({ unit_type_id: utid, count: merged[utid] });
      }
    }
    this.state.pending_purchases[factionId] = result;
  }

  private validatePlacementCommand(cmd: Command): StubResult | null {
    const placements: Dict[] = cmd.payload.placements ?? [];
    const factionId = cmd.player_id;
    const pending = this.state.pending_purchases[factionId] ?? [];
    const pendingCounts: Record<string, number> = {};
    for (const line of pending) {
      const utid = String(line.unit_type_id ?? "");
      pendingCounts[utid] = (pendingCounts[utid] ?? 0) + Math.trunc(Number(line.count ?? 0));
    }

    for (const p of placements) {
      const regionId = String(p.region_id ?? "");
      for (const u of (p.units ?? []) as Dict[]) {
        const unitTypeId = String(u.unit_type_id ?? "");
        const count = Math.trunc(Number(u.count ?? 1));
        if (!this.ruleset!.canMobilizeUnitAt(unitTypeId, regionId, factionId, this.state)) {
          return this.placementError(`Cannot mobilize ${unitTypeId} at ${regionId}`);
        }
        const have = pendingCounts[unitTypeId] ?? 0;
        if (have < count) {
          return this.placementError(`Not enough pending ${unitTypeId} (have ${have}, need ${count})`);
        }
        pendingCounts[unitTypeId] = have - count;
      }
    }
    return null;
  }

  private placementError(message: string): StubResult {
    return { result_type: "error", error: { code: "PLACEMENT_INVALID", message }, events: [] };
  }

  private forfeitPendingAtMobilizeEnd(factionId: string): GameEvent[] {
    const pending = this.state.pending_purchases[factionId] ?? [];
    if (pending.length === 0) {
      return [];
    }

    let ipcLost = 0;
    for (const p of pending) {
      const utid = String(p.unit_type_id ?? "");
      const count = Math.trunc(Number(p.count ?? 1));
      let cost = Math.trunc(Number(UNIT_COSTS[utid] ?? 0));
      if (cost === 0) {
        const ut = this.state.unit_types[utid];
        if (ut) {
          cost = ut.cost;
        }
      }
      ipcLost += cost * count;
    }

    this.state.pending_purchases[factionId] = [];
    this._seq += 1;
    return [
      GameEvent.create(
        GameEventType.PLACEMENT_FORFEITED,
        {
          faction_id: factionId,
          reason: "unplaced_at_mobilize_end",
          forfeited_units: pending,
          ipc_lost: ipcLost,
        },
        this._seq,
      ),
    ];
  }

  getLegalMobilizeRegions(factionId: string, unitTypeId: string): string[] {
    return this.ruleset!.getLegalMobilizeRegions(factionId, unitTypeId, this.state);
  }

  getLegalMoveDestinations(fromRegion: string, unitTypeId: string, factionId: string, instanceId = ""): string[] {
    const validator = new MovementValidator();
    if (instanceId !== "") {
      return validator.getLegalDestinationsForInstance(instanceId, factionId, this.state, this.ruleset!);
    }
    return validator.getLegalDestinationsForStack(fromRegion, unitTypeId, factionId, this.state, this.ruleset!);
  }

  findTransportForLoad(fromRegion: string, seaRegion: string, unitTypeId: string, factionId: string): string {
    return new TransportLoadValidator().findTransportForLoad(fromRegion, seaRegion, unitTypeId, factionId, this.state);
  }

  getLegalLoadDestinations(fromRegion: string, unitTypeId: string, factionId: string): string[] {
    return new TransportLoadValidator().getLegalLoadDestinations(fromRegion, unitTypeId, factionId, this.state);
  }

  private validateMoveCommand(cmd: Command): StubResult | null {
    if (!["combat_move", "noncombat_move"].includes(this.state.current_phase)) {
      return this.moveError("Not in a movement phase");
    }
    const validator = new MovementValidator();
    for (const move of (cmd.payload.moves ?? []) as unknown[]) {
      if (!isDict(move)) {
        continue;
      }
      const fromRegion = String(move.from_region_id ?? "");
      const toRegion = String(move.to_region_id ?? "");
      for (const unitEntry of (move.units ?? []) as unknown[]) {
        if (!isDict(unitEntry)) {
          continue;
        }
        const instanceId = String(unitEntry.instance_id ?? "");
        let result: ValidationResult;
        if (instanceId !== "") {
          result = validator.validateInstanceMove(
            fromRegion,
            toRegion,
            instanceId,
            cmd.player_id,
            this.state,
            this.ruleset!,
          );
        } else {
          result = validator.validateStackMove(
            fromRegion,
            toRegion,
            String(unitEntry.unit_type_id ?? ""),
            cmd.player_id,
            Math.trunc(Number(unitEntry.count ?? 1)),
            this.state,
            this.ruleset!,
          );
        }
        if (!result.ok && result.errors.length > 0) {
          return this.moveError(String(result.errors[0].message), String(result.errors[0].code));
        }
      }
    }
    return null;
  }

  private validateLoadCommand(cmd: Command): StubResult | null {
    if (!["combat_move", "noncombat_move"].includes(this.state.current_phase)) {
      return this.loadError("Not in a movement phase");
    }
    const transportId = String(cmd.payload.transport_instance_id ?? "");
    const fromRegion = String(cmd.payload.from_region_id ?? "");
    const units: unknown[] = cmd.payload.units ?? [];
    const result = new TransportLoadValidator().validateLoad(transportId, fromRegion, units, cmd.player_id, this.state);
    if (!result.ok && result.errors.length > 0) {
      return this.loadError(String(result.errors[0].message), String(result.errors[0].code));
    }
    return null;
  }

  private loadError(message: string, code = "LOAD_INVALID"): StubResult {
    return { result_type: "error", error: { code, message }, events: [] };
  }

  private moveError(message: string, code = "MOVE_INVALID"): StubResult {
    return { result_type: "error", error: { code, message }, events: [] };
  }

  getPendingBattles(factionId: string): Battle[] {
    if (this.combat == null) {
      return [];
    }
    return this.combat.identifyBattles(factionId);
  }

  private validateStrategicBomb(cmd: Command): StubResult | null {
    if (this.state.current_phase !== "combat") {
      return this.bombError("Strategic bombing only in combat phase");
    }
    const regionId = String(cmd.payload.region_id ?? "");
    if (regionId === "") {
      return this.bombError("Missing target region");
    }
    if (this.ruleset == null) {
      this.ruleset = new Ruleset();
      this.ruleset.syncFromState(this.state);
    }
    if (!this.ruleset.isValidBombTarget(regionId, cmd.player_id, this.state)) {
      return this.bombError("Region is not a valid bombing target");
    }
    if (RegionUnitDisplay.bombUnitCount(this.state, regionId, cmd.player_id) <= 0) {
      return this.bombError(`No strategic bombers available at ${regionId}`);
    }
    return null;
  }

  /** Damage uses `(nextInt() % 6) + 1` like CombatEngine, and is reported as negative income. */
  private processStrategicBomb(cmd: Command): GameEvent[] {
    const regionId = String(cmd.payload.region_id ?? "");
    const owner = this.state.getRegionOwner(regionId);
    const damage = this.rng ? (this.rng.nextInt() % 6) + 1 : 1;
    if (owner !== "") {
      this.state.modifyIpc(owner, -damage);
    }
    this.removeOneStrategicBomber(regionId, cmd.player_id);
    this._seq += 1;
    return [
      GameEvent.create(
        GameEventType.INCOME_COLLECTED,
        { faction_id: owner, amount: -damage, reason: "strategic_bomb", region_id: regionId },
        this._seq,
      ),
    ];
  }

  private removeOneStrategicBomber(regionId: string, factionId: string): void {
    const units = this.state.region_units[regionId] ?? [];
    for (let i = units.length - 1; i >= 0; i--) {
      const entry = units[i];
      if (String(entry.faction_id ?? "") !== factionId) {
        continue;
      }
      if (!RegionUnitDisplay.isStrategicBomber(this.state, String(entry.unit_type_id ?? ""))) {
        continue;
      }
      if ("instance_id" in entry) {
        units.splice(i, 1);
        return;
      }
      const count = Math.trunc(Number(entry.count ?? 0));
      if (count <= 1) {
        units.splice(i, 1);
      } else {
        entry.count = count - 1;
      }
      return;
    }
  }

  private bombError(message: string, code = "BOMB_INVALID"): StubResult {
    return { result_type: "error", error: { code, message }, events: [] };
  }
}
