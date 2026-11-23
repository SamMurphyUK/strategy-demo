import type { GameState } from "../../engine/model/game_state";
import type { StackEntry } from "../map/geometry";

/** 0 movable own, 1 spent own, 2 allied, 3 hostile. */
export function medallionRank(state: GameState, activeFaction: string, movable: boolean, entry: StackEntry): number {
  const owner = entry.faction_id;
  if (owner === activeFaction) {
    return movable ? 0 : 1;
  }
  if (owner !== "" && state.sameTeam(owner, activeFaction)) {
    return 2;
  }
  return 3;
}

export function sortMedallions<T extends StackEntry>(
  state: GameState,
  activeFaction: string,
  entries: readonly T[],
  movable: (entry: T) => boolean,
): T[] {
  return entries
    .map((entry, index) => ({ entry, index, rank: medallionRank(state, activeFaction, movable(entry), entry) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((row) => row.entry);
}

export function territoryStatus(state: GameState, activeFaction: string, ownerId: string, entries: readonly StackEntry[]): "FRIENDLY" | "HOSTILE" | "CONTESTED" {
  const friendly = entries.some((entry) => entry.faction_id !== "" && (entry.faction_id === activeFaction || state.sameTeam(entry.faction_id, activeFaction)));
  const hostile = entries.some((entry) => entry.faction_id !== "" && entry.faction_id !== activeFaction && !state.sameTeam(entry.faction_id, activeFaction));
  if (friendly && hostile) {
    return "CONTESTED";
  }
  if (hostile || (ownerId !== "" && ownerId !== activeFaction && !state.sameTeam(ownerId, activeFaction))) {
    return "HOSTILE";
  }
  return "FRIENDLY";
}
