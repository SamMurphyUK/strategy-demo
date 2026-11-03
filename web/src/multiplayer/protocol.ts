import type { CanonicalEvent, StubStateSnapshot } from "../engine/session/game_session_stub";
import type { Dict } from "../engine/model/types";

/** Game socket. The Vite dev server stays on 5173 and is not this host. */
export const MULTIPLAYER_PORT = 8787;

/** One token plays both Axis powers. */
export const AXIS_FACTIONS = ["ger", "jap"] as const;

/** One token plays the Allied powers. */
export const ALLIES_FACTIONS = ["ussr", "uk", "usa"] as const;

export interface SeatSpec {
  playerToken: string;
  factions: string[];
  /** Public label. The player token is the credential and is not copied onto broadcasts. */
  seatId?: string;
}

export interface SeatAssignment {
  seatId: string;
  factions: string[];
}

/** What a reconnecting seat receives, without the seeded PRNG cursor. */
export interface ResumeBody {
  seq: number;
  seatAssignments: SeatAssignment[];
  snapshot: StubStateSnapshot;
}

/** One accepted command, echoed to every connection in the room. */
export interface SyncBody {
  seq: number;
  command: Dict;
  events: CanonicalEvent[];
  snapshot: StubStateSnapshot;
}

export type ClientMessage =
  | { type: "join"; roomId: string; playerToken?: string; spectate?: boolean; create?: boolean }
  | { type: "claim"; playerToken: string; seat: string }
  | { type: "command"; playerToken: string; command: Dict };

export type ServerMessage =
  | ({ type: "welcome"; yourFactions: string[]; takenFactions: string[] } & ResumeBody)
  | ({ type: "seats"; yourFactions: string[]; takenFactions: string[] } & ResumeBody)
  | ({ type: "sync" } & SyncBody)
  | { type: "rejected"; code: string; message: string };
