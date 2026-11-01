import {
  buildFactionsData,
  buildMapData,
  buildSetupData,
  NEWMAP_PATH,
  RULES_PATH,
  UNITS_PATH,
} from "../../content/game_scene_session_builder";
import { loadJson } from "../content/res";
import { GameSession } from "./game_session";
import { GameSessionStub } from "./game_session_stub";

export const SessionMode = {
  STUB: "stub",
  FULL: "full",
} as const;

export type SessionModeValue = (typeof SessionMode)[keyof typeof SessionMode];

export const DEFAULT_MODE: SessionModeValue = SessionMode.STUB;

/** GameSceneSessionBuilder.create_session_from_newmap */
export function createSessionFromNewmap(): GameSession {
  const mapJson = loadJson(NEWMAP_PATH);
  return GameSession.create(
    buildMapData(mapJson),
    loadJson(UNITS_PATH),
    buildFactionsData(mapJson),
    buildSetupData(mapJson),
    loadJson(RULES_PATH),
    { state: 12345, sequence: 1 },
  );
}

export class GameSessionFactory {
  static create(mode: typeof SessionMode.STUB): GameSessionStub;
  static create(mode: typeof SessionMode.FULL): GameSession;
  static create(mode?: SessionModeValue): GameSessionStub | GameSession;
  static create(mode: SessionModeValue = DEFAULT_MODE): GameSessionStub | GameSession {
    if (mode === SessionMode.FULL) {
      return createSessionFromNewmap();
    }
    const stub = new GameSessionStub();
    stub.initializeDemo(12345);
    return stub;
  }

  static loadJson = loadJson;
}
