import type { GameState } from "../model/game_state";
import type { PurchaseLine } from "../model/types";

/** Purchased units still waiting to be placed this turn. */
export function unplacedPurchases(state: GameState, factionId: string): PurchaseLine[] {
  return (state.pending_purchases[factionId] ?? []).filter((line) => Math.trunc(Number(line.count ?? 0)) > 0);
}

/** Empty when mobilize may end. */
export function mustPlaceMessage(state: GameState, factionId: string): string {
  const lines = unplacedPurchases(state, factionId);
  if (lines.length === 0) {
    return "";
  }
  const text = lines
    .map((line) => {
      const name = state.unit_types[line.unit_type_id]?.name || line.unit_type_id;
      return `${Math.trunc(Number(line.count ?? 0))} ${name}`;
    })
    .join(", ");
  return `Place purchased units before ending the phase: ${text}.`;
}
