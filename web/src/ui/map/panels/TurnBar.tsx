import { type CSSProperties, useEffect, useState, useSyncExternalStore } from "react";
import { playUiPanelFlick, sfxMuted, subscribeSfx, toggleSfx } from "../../../audio/sound_manager";
import { PHASES } from "../../../engine/turn/turn_engine";
import { factionPalette } from "../../theme/factionPalette";
import type { MapVersion } from "../editor/mapVersions";
import { factionName, phaseName } from "../session/event_text";
import type { RoomControls } from "../session/use_campaign_session";
import { RoundelBadge } from "../../../components/ui/RoundelBadge";
import { RoomPill } from "./RoomPill";
import { DEMO_MAP_ID, demoPlayChoice, playChoiceFromVersion } from "../session/play_map";
import type { GameSessionHandle } from "../session/use_game_session";
import type { CampaignLaunchConfig } from "../../../engine/types/ruleset";

function factionStyle(factionId: string): CSSProperties {
  const palette = factionPalette(factionId);
  return { "--faction": palette.primary, "--faction-ring": palette.ring } as CSSProperties;
}

interface Props {
  game: GameSessionHandle;
  editing: boolean;
  versions: MapVersion[];
  onToggleEditing(): void;
  onMenu?(): void;
  playerFaction?: string;
  room?: RoomControls;
  launch?: CampaignLaunchConfig;
  onNewCampaign?(): void;
}

export function TurnBar({ game, editing, versions, onToggleEditing, onMenu, playerFaction, room, launch, onNewCampaign }: Props) {
  const state = game.session.state;
  const [seedInput, setSeedInput] = useState(String(game.seed));
  const [mapId, setMapId] = useState(game.mapId);
  useEffect(() => {
    setMapId(game.mapId);
  }, [game.mapId]);
  useEffect(() => {
    if (mapId !== game.mapId && mapId !== DEMO_MAP_ID && !versions.some((version) => version.id === mapId)) {
      setMapId(DEMO_MAP_ID);
    }
  }, [versions, mapId, game.mapId]);
  const muted = useSyncExternalStore(subscribeSfx, sfxMuted, () => false);
  const faction = state.current_faction_id;
  const phaseIndex = PHASES.indexOf(state.current_phase as (typeof PHASES)[number]);
  const mapListed = mapId === DEMO_MAP_ID || versions.some((version) => version.id === mapId);

  return (
    <header className="turn-bar">
      <div className="turn-info">
        <span className="faction-chip" style={factionStyle(faction)}>
          <RoundelBadge faction={faction} size="sm" label="" />
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
            <RoundelBadge faction={f} size="sm" label="" />
            {factionName(f)} <b className="mono">{state.getFactionIpc(f)}</b> GDP
          </span>
        ))}
      </div>
      {room && <RoomPill room={room} launch={room.launch ?? launch} />}
      {onNewCampaign && (
        <button type="button" onClick={onNewCampaign}>
          New Campaign
        </button>
      )}
      <button
        type="button"
        className="sfx-toggle"
        aria-pressed={muted}
        onClick={() => {
          if (muted) {
            toggleSfx();
            playUiPanelFlick();
          } else {
            playUiPanelFlick();
            toggleSfx();
          }
        }}
      >
        [ SFX: {muted ? "OFF" : "ON"} ]
      </button>
      <button type="button" className={editing ? "active editor-toggle" : "editor-toggle"} onClick={onToggleEditing}>
        {editing ? "Back to game" : "Map editor"}
      </button>
      {playerFaction && <span className="turn-you">You: {factionName(playerFaction)}</span>}
      {onMenu && (
        <button type="button" onClick={onMenu}>
          Menu
        </button>
      )}
      <form
        className="seed"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Math.trunc(Number(seedInput));
          const version = versions.find((item) => item.id === mapId);
          game.newGame(Number.isFinite(n) ? n : 12345, version ? playChoiceFromVersion(version) : demoPlayChoice());
          if (editing) {
            onToggleEditing();
          }
        }}
      >
        <label>
          Map
          <select aria-label="Map" value={mapId} onChange={(e) => setMapId(e.target.value)}>
            <option value={DEMO_MAP_ID}>Demo map</option>
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.name}
              </option>
            ))}
            {mapId === game.mapId && !mapListed && <option value={mapId}>{game.mapName}</option>}
          </select>
        </label>
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
