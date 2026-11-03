import { useCallback, useMemo, useRef, useState } from "react";
import { planesLostMessage, planesMustLandMessage, strandedPlanes } from "../../../engine/air/air_fuel";
import { strandedCargoGate } from "../../../engine/transport/cargo_rules";
import { mustPlaceMessage } from "../../../engine/placement/unplaced";
import type { Dict } from "../../../engine/model/types";
import {
  GameSessionStub,
  type CanonicalEvent,
  type StubResult,
  type StubStateSnapshot,
} from "../../../engine/session/game_session_stub";
import { applyAuthoritativeSnapshot } from "../../../multiplayer/multiplayer_client";
import { describeEvent, unitName } from "./event_text";
import { type PlayChoice, demoPlayChoice, initialPlayChoice, rememberPlayId } from "./play_map";

export interface LogEntry {
  id: number;
  kind: "event" | "error";
  text: string;
}

export interface GameSessionHandle {
  session: GameSessionStub;
  /** Bumped after every command so components re-read the live state. */
  version: number;
  seed: number;
  log: LogEntry[];
  send(type: string, payload?: Dict): StubResult;
  /** Drops one movement order through `cancel_phase_order`, so the reversal is a command. */
  cancelPhaseOrder(orderId: string): void;
  /** Lock the board to a host snapshot and append the events that produced it. */
  applyRemote(snapshot: StubStateSnapshot, events: CanonicalEvent[]): void;
  /** Record a host rejection without touching the rules. */
  noteError(message: string): void;
  /** Starts a new game on `choice`. Omit it to restart the map already being played. */
  newGame(seed: number, choice?: PlayChoice): void;
  /** `demo`, or the id of the saved version this game was started from. */
  mapId: string;
  mapName: string;
  /** World-space JSON for a saved version. Null while the built-in demo file is in play. */
  map: Dict | null;
}

const MAX_LOG = 200;

function createSession(seed: number, map: Dict | null): GameSessionStub {
  const s = new GameSessionStub();
  if (map) {
    s.initializeFromMap(map, seed);
  } else {
    s.initializeDemo(seed);
  }
  return s;
}

export function useGameSession(initialSeed = 12345): GameSessionHandle {
  const [seed, setSeed] = useState(initialSeed);
  const opened = useRef<PlayChoice | null>(null);
  if (opened.current === null) {
    opened.current = initialPlayChoice();
  }
  const [choice, setChoice] = useState<PlayChoice>(opened.current);
  const choiceRef = useRef(choice);
  choiceRef.current = choice;
  const sessionRef = useRef<GameSessionStub | null>(null);
  if (sessionRef.current === null) {
    sessionRef.current = createSession(initialSeed, opened.current.map);
  }
  const counter = useRef(0);
  const logId = useRef(0);
  const [version, setVersion] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);

  const append = useCallback((entries: Omit<LogEntry, "id">[]) => {
    if (entries.length === 0) {
      return;
    }
    setLog((prev) => {
      const next = [...prev, ...entries.map((e) => ({ ...e, id: ++logId.current }))];
      return next.length > MAX_LOG ? next.slice(next.length - MAX_LOG) : next;
    });
  }, []);

  const send = useCallback(
    (type: string, payload: Dict = {}): StubResult => {
      const session = sessionRef.current!;
      let lostMessage = "";
      if (type === "end_phase" && session.state.current_phase === "mobilize") {
        const message = mustPlaceMessage(session.state, session.state.current_faction_id);
        if (message !== "") {
          append([{ kind: "error", text: message }]);
          setVersion((v) => v + 1);
          return { result_type: "error", error: { code: "UNITS_UNPLACED", message }, events: [] };
        }
      }
      if (type === "end_phase" && session.state.current_phase === "combat_move") {
        const cargo = strandedCargoGate(session.state);
        if (!cargo.advance) {
          append([{ kind: "error", text: cargo.warning }]);
          setVersion((v) => v + 1);
          return { result_type: "error", error: { code: "CARGO_STRANDED", message: cargo.warning }, events: [] };
        }
      }
      if (type === "end_phase" && session.state.current_phase === "noncombat_move") {
        const factionId = session.state.current_faction_id;
        const message = planesMustLandMessage(session.state, factionId);
        if (message !== "") {
          append([{ kind: "error", text: message }]);
          setVersion((v) => v + 1);
          return { result_type: "error", error: { code: "PLANES_MUST_LAND", message }, events: [] };
        }
        lostMessage = planesLostMessage(
          session.state,
          strandedPlanes(session.state, factionId).filter((plane) => !plane.canReturn),
        );
      }
      counter.current += 1;
      const result = session.applyCommand({
        command_id: `ui_${String(counter.current).padStart(5, "0")}`,
        player_id: session.state.current_faction_id,
        type,
        payload,
      });
      const unitTypes = session.state.unit_types;
      if (result.result_type === "ok") {
        const lines = result.events.map((evt) => ({ kind: "event" as const, text: describeEvent(evt, unitTypes) }));
        if (lostMessage !== "") {
          lines.push({ kind: "event", text: lostMessage });
        }
        append(lines);
      } else {
        append([
          ...result.events.map((evt) => ({ kind: "event" as const, text: describeEvent(evt, unitTypes) })),
          { kind: "error" as const, text: `${result.error?.code ?? "ERROR"}: ${result.error?.message ?? ""}` },
        ]);
      }
      setVersion((v) => v + 1);
      return result;
    },
    [append],
  );

  const cancelPhaseOrder = useCallback(
    (orderId: string) => {
      const session = sessionRef.current!;
      const order = session.state.phase_orders.find((item) => item.id === orderId);
      if (!order) {
        return;
      }
      const from = session.state.regions[order.fromRegionId]?.name || order.fromRegionId;
      const to = session.state.regions[order.toRegionId]?.name || order.toRegionId;
      const label = unitName(order.unitType, session.state.unit_types);
      counter.current += 1;
      const result = session.applyCommand({
        command_id: `ui_${String(counter.current).padStart(5, "0")}`,
        player_id: session.state.current_faction_id,
        type: "cancel_phase_order",
        payload: { order_id: orderId },
      });
      if (result.result_type === "ok") {
        append([{ kind: "event", text: `Cancelled ${order.count}× ${label}, ${from} → ${to}.` }]);
      } else {
        append([
          { kind: "error", text: `${result.error?.code ?? "ERROR"}: ${result.error?.message ?? ""}` },
        ]);
      }
      setVersion((v) => v + 1);
    },
    [append],
  );

  const applyRemote = useCallback(
    (snapshot: StubStateSnapshot, events: CanonicalEvent[]) => {
      const session = sessionRef.current!;
      applyAuthoritativeSnapshot(session, snapshot);
      const unitTypes = session.state.unit_types;
      append(events.map((evt) => ({ kind: "event" as const, text: describeEvent(evt, unitTypes) })));
      setVersion((v) => v + 1);
    },
    [append],
  );

  const noteError = useCallback(
    (message: string) => {
      append([{ kind: "error", text: message }]);
      setVersion((v) => v + 1);
    },
    [append],
  );

  const newGame = useCallback((nextSeed: number, nextChoice?: PlayChoice) => {
    const picked = nextChoice ?? choiceRef.current ?? demoPlayChoice();
    sessionRef.current = createSession(nextSeed, picked.map);
    rememberPlayId(picked.id);
    choiceRef.current = picked;
    counter.current = 0;
    setChoice(picked);
    setSeed(nextSeed);
    setLog([]);
    setVersion((v) => v + 1);
  }, []);

  // The session is mutated in place, so `version` is what tells React it changed.
  return useMemo(
    () => ({
      session: sessionRef.current!,
      version,
      seed,
      log,
      send,
      cancelPhaseOrder,
      applyRemote,
      noteError,
      newGame,
      mapId: choice.id,
      mapName: choice.name,
      map: choice.map,
    }),
    [version, seed, log, send, cancelPhaseOrder, applyRemote, noteError, newGame, choice],
  );
}
