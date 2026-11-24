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

/** Kept so older call sites compile. Both values boot the same session. */
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
  static create(_mode: SessionModeValue = DEFAULT_MODE): GameSession {
    const session = new GameSession();
    session.initializeDemo(12345);
    return session;
  }

  static loadJson = loadJson;
}
