import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { factionName } from "./event_text";
import { MultiplayerSession, roomIdFromSearch, type ClientStatus } from "../../../multiplayer/multiplayer_client";
import type { CanonicalEvent } from "../../../engine/session/game_session_stub";
import type { Dict } from "../../../engine/model/types";
import type { StubResult } from "../../../engine/session/game_session_stub";
import { type GameSessionHandle, useGameSession } from "./use_game_session";

const BATTLE_COMMANDS = new Set(["start_battle", "battle_roll", "battle_casualties", "battle_retreat"]);

export interface RoomControls {
  status: ClientStatus;
  roomId: string;
  yourFactions: string[];
  takenFactions: string[];
  connect(roomId: string): void;
  claim(seat: "axis" | "allies"): void;
  disconnect(): void;
}

export interface BattleFeed {
  seq: number;
  commandType: string;
  events: CanonicalEvent[];
}

export interface CampaignPlay {
  game: GameSessionHandle;
  room: RoomControls;
  online: boolean;
  isMyTurn: boolean;
  battleFeed: BattleFeed | null;
}

function viewOf(client: MultiplayerSession): Omit<RoomControls, "connect" | "claim" | "disconnect"> {
  return {
    status: client.status,
    roomId: client.roomId,
    yourFactions: [...client.yourFactions],
    takenFactions: [...client.takenFactions],
  };
}

/**
 * Local play keeps the stub. A room sends each action to the host and locks
 * the board to the snapshot that comes back.
 */
export function useCampaignSession(): CampaignPlay {
  const local = useGameSession(12345);
  const localRef = useRef(local);
  localRef.current = local;
  const clientRef = useRef<MultiplayerSession | null>(null);
  if (clientRef.current === null) {
    clientRef.current = new MultiplayerSession();
  }
  const client = clientRef.current;
  const [roomView, setRoomView] = useState(() => viewOf(client));
  const [battleFeed, setBattleFeed] = useState<BattleFeed | null>(null);
  const pending = useRef(false);

  useEffect(() => {
    return client.subscribe(() => {
      const game = localRef.current;
      if (client.lastNotice === "rejected" && client.rejection) {
        game.noteError(`${client.rejection.code}: ${client.rejection.message}`);
      } else if (client.snapshot && (client.lastNotice === "welcome" || client.lastNotice === "seats" || client.lastNotice === "sync")) {
        const events = client.lastNotice === "sync" ? client.takeNewEvents() : [];
        game.applyRemote(client.snapshot, events);
        if (client.lastNotice === "sync") {
          const frame = client.frames[client.frames.length - 1];
          const commandType = String(frame?.command.type ?? "");
          if (BATTLE_COMMANDS.has(commandType)) {
            setBattleFeed({ seq: frame.seq, commandType, events: frame.events });
          }
        }
      }
      setRoomView(viewOf(client));
    });
  }, [client]);

  useEffect(() => {
    const roomId = roomIdFromSearch(window.location.search);
    if (roomId !== "") {
      void client.connect(roomId).catch((error: unknown) => {
        localRef.current.noteError(error instanceof Error ? error.message : String(error));
      });
    }
  }, [client]);

  const connect = useCallback(
    (roomId: string) => {
      const id = roomId.trim();
      if (id === "") {
        return;
      }
      void client.connect(id).catch((error: unknown) => {
        localRef.current.noteError(error instanceof Error ? error.message : String(error));
      });
    },
    [client],
  );

  const claim = useCallback(
    (seat: "axis" | "allies") => {
      void client.claim(seat).catch((error: unknown) => {
        localRef.current.noteError(error instanceof Error ? error.message : String(error));
      });
    },
    [client],
  );

  const disconnect = useCallback(() => {
    void client.close();
  }, [client]);

  const room = useMemo<RoomControls>(
    () => ({ ...roomView, connect, claim, disconnect }),
    [roomView, connect, claim, disconnect],
  );

  const online = roomView.status === "connecting" || roomView.status === "open" || roomView.status === "reconnecting";
  const activeFaction = local.session.state.current_faction_id;
  const isMyTurn = !online || roomView.yourFactions.includes(activeFaction);

  const game = useMemo<GameSessionHandle>(() => {
    if (!online) {
      return local;
    }
    const send = (type: string, payload: Dict = {}): StubResult => {
      if (!isMyTurn) {
        const message = `OPPONENT TURN (${factionName(local.session.state.current_faction_id)})`;
        local.noteError(message);
        return { result_type: "error", error: { code: "OPPONENT_TURN", message }, events: [] };
      }
      if (pending.current) {
        return { result_type: "error", error: { code: "BUSY", message: "Waiting for the host" }, events: [] };
      }
      pending.current = true;
      void client
        .dispatch(type, local.session.state.current_faction_id, payload)
        .catch((error: unknown) => {
          localRef.current.noteError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          pending.current = false;
        });
      return { result_type: "ok", events: [] };
    };
    return {
      ...local,
      send,
      cancelPhaseOrder(orderId: string) {
        if (!isMyTurn) {
          return;
        }
        send("cancel_phase_order", { order_id: orderId });
      },
    };
  }, [online, isMyTurn, local, client]);

  return { game, room, online, isMyTurn, battleFeed };
}
