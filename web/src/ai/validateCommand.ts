import { CommandValidator } from "../engine/validation/command_validator";
import type { Command } from "../engine/model/command";
import type { GameState } from "../engine/model/game_state";

export interface CommandCheck {
  ok: boolean;
  code: string;
  message: string;
}

/** Phase and turn check. A command is returned only after this passes. */
export function validateCommand(state: GameState, command: Command): CommandCheck {
  const validator = new CommandValidator(state);
  if (!validator.validate(command)) {
    const error = validator.getError();
    return { ok: false, code: error.code, message: error.message };
  }
  return { ok: true, code: "", message: "" };
}
