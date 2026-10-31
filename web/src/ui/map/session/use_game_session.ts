import { useCallback, useMemo, useRef, useState } from "react";
import type { Dict } from "../../../engine/model/types";
import { GameSessionStub, type StubResult } from "../../../engine/session/game_session_stub";
import { describeEvent } from "./event_text";
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
      counter.current += 1;
      const result = session.applyCommand({
        command_id: `ui_${String(counter.current).padStart(5, "0")}`,
        player_id: session.state.current_faction_id,
        type,
        payload,
      });
      const unitTypes = session.state.unit_types;
      if (result.result_type === "ok") {
        append(result.events.map((evt) => ({ kind: "event" as const, text: describeEvent(evt, unitTypes) })));
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
      newGame,
      mapId: choice.id,
      mapName: choice.name,
      map: choice.map,
    }),
    [version, seed, log, send, newGame, choice],
  );
}
