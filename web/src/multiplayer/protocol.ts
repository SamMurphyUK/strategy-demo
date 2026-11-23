import type { CanonicalEvent, StubStateSnapshot } from "../engine/session/game_session_stub";
import type { Dict } from "../engine/model/types";
import type { CampaignLaunchConfig } from "../engine/types/ruleset";

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
  /** Present once a seat has named the campaign rules. Older rooms omit it. */
  launch?: CampaignLaunchConfig;
}

/** One accepted command, echoed to every connection in the room. */
export interface SyncBody {
  seq: number;
  command: Dict;
  events: CanonicalEvent[];
  snapshot: StubStateSnapshot;
}

export type ClientMessage =
  | { type: "join"; roomId: string; playerToken?: string; spectate?: boolean; create?: boolean; launch?: CampaignLaunchConfig }
  | { type: "claim"; playerToken: string; seat: string }
  | { type: "command"; playerToken: string; command: Dict };

/**
 * Lockstep start. The host sends this on port 8787 after welcome once a seat
 * has named the campaign, and again to every seat already at the table.
 * `phase` is the start marker. Older rooms never send this message.
 */
export interface SessionInitBody {
  type: "SESSION_INIT";
  phase: "START_CAMPAIGN";
  launch: CampaignLaunchConfig;
  seq: number;
  snapshot: StubStateSnapshot;
}

export type ServerMessage =
  | ({ type: "welcome"; yourFactions: string[]; takenFactions: string[] } & ResumeBody)
  | ({ type: "seats"; yourFactions: string[]; takenFactions: string[] } & ResumeBody)
  | ({ type: "sync" } & SyncBody)
  | SessionInitBody
  | { type: "rejected"; code: string; message: string };
