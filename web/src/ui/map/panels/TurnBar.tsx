import { useState } from "react";
import { factionName, phaseName } from "../session/event_text";
import type { GameSessionHandle } from "../session/use_game_session";

export function TurnBar({ game }: { game: GameSessionHandle }) {
  const state = game.session.state;
  const [seedInput, setSeedInput] = useState(String(game.seed));
  const faction = state.current_faction_id;

  return (
    <header className="turn-bar">
      <div className="turn-info">
        <span className={`faction-chip faction-${faction}`}>{factionName(faction)}</span>
        <span>Round {state.game_round}</span>
        <span>Turn {state.turn_number}</span>
        <span className="phase">{phaseName(state.current_phase)}</span>
      </div>
      <div className="ipc">
        {state.turn_order.map((f) => (
          <span key={f} className={f === faction ? "ipc-active" : ""}>
            {factionName(f)} {state.getFactionIpc(f)} IPC
          </span>
        ))}
      </div>
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
          <input value={seedInput} onChange={(e) => setSeedInput(e.target.value)} inputMode="numeric" />
        </label>
        <button type="submit">New game</button>
      </form>
      {state.game_over && <div className="game-over">{factionName(state.winner_faction_id)} wins</div>}
    </header>
  );
}
