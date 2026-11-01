import type { Command } from "../model/command";
import { GameEvent, GameEventType } from "../model/event";
import type { GameState } from "../model/game_state";
import type { Dict } from "../model/types";

export class EconomyEngine {
  private _seq = 0;

  constructor(public state: GameState) {}

  setSequence(seq: number): void {
    this._seq = seq;
  }

  private nextSeq(): number {
    this._seq += 1;
    return this._seq;
  }

  calculateIncome(factionId: string): number {
    let totalIpc = 0;
    for (const regionId of Object.keys(this.state.regions)) {
      const region = this.state.regions[regionId];
      if (region.owner_faction_id === factionId && region.isLandRegion()) {
        totalIpc += region.ipc_value;
      }
    }
    return totalIpc;
  }

  collectIncome(factionId: string): GameEvent[] {
    const income = this.calculateIncome(factionId);
    this.state.ipc[factionId] = (this.state.ipc[factionId] ?? 0) + income;
    return [
      GameEvent.create(
        GameEventType.INCOME_COLLECTED,
        { faction_id: factionId, amount: income, new_total: this.state.ipc[factionId] },
        this.nextSeq(),
      ),
    ];
  }

  /** Accepts payload.purchases or payload.units. */
  processPurchase(cmd: Command): GameEvent[] {
    const events: GameEvent[] = [];
    const factionId = cmd.player_id;

    let purchases: Dict[] = cmd.payload.purchases ?? [];
    if (purchases.length === 0) {
      purchases = cmd.payload.units ?? [];
    }

    let totalCost = 0;
    for (const purchase of purchases) {
      const unitTypeId = String(purchase.unit_type_id ?? "");
      const count = Math.trunc(Number(purchase.count ?? 1));
      const u = this.state.unit_types[unitTypeId];
      if (u) {
        totalCost += u.cost * count;
      }
    }

    if (totalCost > (this.state.ipc[factionId] ?? 0)) {
      return [
        GameEvent.create(
          GameEventType.PURCHASE_FAILED,
          { faction_id: factionId, reason: "insufficient_ipc" },
          this.nextSeq(),
        ),
      ];
    }

    this.state.ipc[factionId] -= totalCost;
    this.state.pending_purchases[factionId] = purchases as GameState["pending_purchases"][string];

    events.push(
      GameEvent.create(
        GameEventType.UNITS_PURCHASED,
        { faction_id: factionId, units: purchases, cost: totalCost },
        this.nextSeq(),
      ),
    );
    return events;
  }

  canAfford(factionId: string, unitTypeId: string, count = 1): boolean {
    const u = this.state.unit_types[unitTypeId];
    if (u == null) {
      return false;
    }
    return (this.state.ipc[factionId] ?? 0) >= u.cost * count;
  }
}
