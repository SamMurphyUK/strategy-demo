import { GameEvent } from "../model/event";
import { type Dict, deepCopy, isDict } from "../model/types";
import { GameSessionStub } from "./game_session_stub";

export interface SessionLike {
  applyCommand(cmd: Dict): Dict;
  getState?(): Dict;
  getLegalCommands?(playerId: string): string[];
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

export class GameSessionAdapter {
  debug = false;

  constructor(public session: SessionLike | null = null) {}

  static fromSession(sessionInstance: SessionLike | null): GameSessionAdapter {
    return new GameSessionAdapter(sessionInstance);
  }

  applyCommand(cmd: Dict): Dict {
    if (this.session == null) {
      return { result_type: "error", error: { code: "NO_SESSION", message: "Session not set" }, events: [] };
    }

    const typeName = String(cmd.type ?? "").toLowerCase();
    const mapped = this.mapCommandType(typeName);
    if (mapped !== typeName) {
      cmd = { ...deepCopy(cmd), type: mapped };
    }

    const result = this.session.applyCommand(cmd);
    if (String(result.result_type ?? "") !== "ok") {
      return result;
    }

    const sourceId = String(cmd.command_id ?? "");
    result.events = ((result.events ?? []) as unknown[]).map((raw) => this.toCanonicalEvent(raw, sourceId));
    return result;
  }

  getState(): Dict {
    if (this.session == null || typeof this.session.getState !== "function") {
      return {};
    }
    return this.session.getState();
  }

  getLegalCommands(playerId: string): string[] {
    if (this.session != null && typeof this.session.getLegalCommands === "function") {
      return this.session.getLegalCommands(playerId);
    }
    return [];
  }

  static validateEventShape(evt: Dict): boolean {
    return GameSessionStub.validateEventShape(evt);
  }

  /** Identity for every type the adapter currently knows. */
  private mapCommandType(typeName: string): string {
    return typeName;
  }

  toCanonicalEvent(raw: unknown, sourceCommandId: string): Dict {
    if (raw instanceof GameEvent) {
      return {
        event_id: String(raw.event_id).replaceAll("_", ""),
        sequence: raw.sequence,
        type: this.normalizeType(GameEvent.typeToString(raw.type)),
        payload: deepCopy(raw.payload),
        source_command_id: sourceCommandId,
        timestamp: unixNow(),
      };
    }

    if (isDict(raw)) {
      const d: Dict = deepCopy(raw);
      if (!("source_command_id" in d)) {
        d.source_command_id = sourceCommandId;
      }
      d.type = this.normalizeType(String(d.type ?? ""));
      if ("event_id" in d) {
        d.event_id = String(d.event_id).replaceAll("_", "");
      }
      if (!("timestamp" in d)) {
        d.timestamp = unixNow();
      }
      return d;
    }

    return {};
  }

  private normalizeType(typeName: string): string {
    return String(typeName).toLowerCase().replaceAll("_", "");
  }
}
