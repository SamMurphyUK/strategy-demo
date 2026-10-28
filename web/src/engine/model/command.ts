import type { Dict } from "./types";

export const CommandType = {
  PURCHASE_UNITS: "purchase_units",
  MOVE_UNITS: "move_units",
  LOAD_TRANSPORT: "load_transport",
  UNLOAD_TRANSPORT: "unload_transport",
  DESIGNATE_AMPHIBIOUS: "designate_amphibious",
  PLACE_UNITS: "place_units",
  END_PHASE: "end_phase",
  END_TURN: "end_turn",
  STRATEGIC_BOMB: "strategic_bomb",
} as const;

export type CommandTypeValue = (typeof CommandType)[keyof typeof CommandType];

const KNOWN_TYPES = new Set<string>(Object.values(CommandType));

export class Command {
  command_id = "";
  player_id = "";
  faction_id = "";
  type: CommandTypeValue = CommandType.END_PHASE;
  payload: Dict = {};

  static fromDict(data: Dict): Command {
    const cmd = new Command();
    cmd.command_id = data.command_id ?? "";
    cmd.player_id = data.player_id ?? "";
    cmd.faction_id = data.faction_id ?? cmd.player_id;
    cmd.type = Command.parseType(data.type ?? "");
    cmd.payload = data.payload ?? {};
    return cmd;
  }

  /** Unknown strings fall back to END_PHASE, as in command.gd. */
  static parseType(typeString: unknown): CommandTypeValue {
    const t = String(typeString).trim().toLowerCase();
    return KNOWN_TYPES.has(t) ? (t as CommandTypeValue) : CommandType.END_PHASE;
  }
}
