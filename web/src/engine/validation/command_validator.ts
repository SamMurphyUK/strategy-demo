import { type Command, CommandType, type CommandTypeValue } from "../model/command";
import type { GameState } from "../model/game_state";

export const PHASE_COMMANDS: Record<string, readonly CommandTypeValue[]> = {
  purchase: [CommandType.PURCHASE_UNITS, CommandType.END_PHASE],
  combat_move: [
    CommandType.MOVE_UNITS,
    CommandType.LOAD_TRANSPORT,
    CommandType.DESIGNATE_AMPHIBIOUS,
    CommandType.END_PHASE,
  ],
  combat: [CommandType.STRATEGIC_BOMB, CommandType.END_PHASE],
  noncombat_move: [
    CommandType.MOVE_UNITS,
    CommandType.LOAD_TRANSPORT,
    CommandType.UNLOAD_TRANSPORT,
    CommandType.END_PHASE,
  ],
  mobilize: [CommandType.PLACE_UNITS, CommandType.END_PHASE],
  collect_income: [CommandType.END_TURN],
};

export interface CommandError {
  code: string;
  message: string;
}

export class CommandValidator {
  errorCode = "";
  errorMessage = "";

  constructor(public state: GameState) {}

  validate(command: Command): boolean {
    this.errorCode = "";
    this.errorMessage = "";
    if (command.player_id !== this.state.current_faction_id) {
      this.errorCode = "OUT_OF_TURN";
      this.errorMessage = "Not your turn";
      return false;
    }
    const legal = PHASE_COMMANDS[this.state.current_phase] ?? [];
    if (!legal.includes(command.type)) {
      this.errorCode = "ILLEGAL_ACTION";
      this.errorMessage = "Command not allowed in phase";
      return false;
    }
    return true;
  }

  getError(): CommandError {
    return { code: this.errorCode, message: this.errorMessage };
  }
}
