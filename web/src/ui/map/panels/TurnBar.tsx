import { type CSSProperties, useState } from "react";
import { PHASES } from "../../../engine/turn/turn_engine";
import { factionPalette } from "../../theme/factionPalette";
import { factionName, phaseName } from "../session/event_text";
import type { GameSessionHandle } from "../session/use_game_session";

function factionStyle(factionId: string): CSSProperties {
  const palette = factionPalette(factionId);
  return { "--faction": palette.primary, "--faction-ring": palette.ring } as CSSProperties;
}

interface Props {
  game: GameSessionHandle;
  editing: boolean;
  onToggleEditing(): void;
}

export function TurnBar({ game, editing, onToggleEditing }: Props) {
  const state = game.session.state;
  const [seedInput, setSeedInput] = useState(String(game.seed));
  const faction = state.current_faction_id;
  const phaseIndex = PHASES.indexOf(state.current_phase as (typeof PHASES)[number]);

  return (
    <header className="turn-bar">
      <div className="turn-info">
        <span className="faction-chip" style={factionStyle(faction)}>
          {factionName(faction)}
        </span>
        <span className="turn-count">
          Round <b className="mono">{state.game_round}</b> · Turn <b className="mono">{state.turn_number}</b>
        </span>
      </div>
      <ol className="phase-tracker" aria-label="Turn phases">
        {PHASES.map((phase, i) => (
          <li
            key={phase}
            className={i === phaseIndex ? "current" : i < phaseIndex ? "done" : ""}
            aria-current={i === phaseIndex ? "step" : undefined}
          >
            {phaseName(phase)}
          </li>
        ))}
      </ol>
      <div className="ipc">
        {state.turn_order.map((f) => (
          <span key={f} className={f === faction ? "ipc-active" : ""} style={factionStyle(f)}>
            {factionName(f)} <b className="mono">{state.getFactionIpc(f)}</b> IPC
          </span>
        ))}
      </div>
      <button type="button" className={editing ? "active editor-toggle" : "editor-toggle"} onClick={onToggleEditing}>
        {editing ? "Back to game" : "Map editor"}
      </button>
      <form
        className="seed"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Math.trunc(Number(seedInput));
          game.newGame(Number.isFinite(n) ? n : 12345);
        }}
      >
        <label>
          Seed
          <input
            className="mono"
            value={seedInput}
            onChange={(e) => setSeedInput(e.target.value)}
            inputMode="numeric"
          />
        </label>
        <button type="submit">New game</button>
      </form>
      {state.game_over && <div className="game-over">{factionName(state.winner_faction_id)} wins</div>}
    </header>
  );
}
