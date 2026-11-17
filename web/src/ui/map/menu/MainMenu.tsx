import { useState } from "react";
import { useSyncExternalStore } from "react";
import { sfxMuted, subscribeSfx, toggleSfx } from "../../../audio/sound_manager";
import type { Dict } from "../../../engine/model/types";
import { isDict } from "../../../engine/model/types";
import type { MapVersion } from "../editor/mapVersions";
import { factionName } from "../session/event_text";
import { demoPlayChoice, playChoiceFromVersion, type PlayChoice } from "../session/play_map";
import type { RoomControls } from "../session/use_campaign_session";
import { parseCampaignSave, type CampaignSave } from "./campaignSave";

const FACTIONS = ["ussr", "ger", "uk", "jap", "usa"] as const;
export const MENU_VERSION = "0.1.0";

type Page = "home" | "new" | "load" | "online" | "settings";

export function MainMenu({
  mapName,
  versions,
  saves,
  room,
  volume,
  look,
  playerFaction,
  onVolume,
  onLook,
  onPlayerFaction,
  onNewCampaign,
  onResume,
  onSaveNow,
  onOpenEditor,
  onImportMap,
}: {
  mapName: string;
  versions: MapVersion[];
  saves: CampaignSave[];
  room: RoomControls;
  volume: number;
  look: "field" | "dusk";
  playerFaction: string;
  onVolume(value: number): void;
  onLook(look: "field" | "dusk"): void;
  onPlayerFaction(factionId: string): void;
  onNewCampaign(choice: PlayChoice, seed: number): void;
  onResume(save: CampaignSave): void;
  onSaveNow(): void;
  onOpenEditor(): void;
  /** Stores an imported map and returns an error, or "". */
  onImportMap(name: string, map: Dict): string;
}) {
  const [page, setPage] = useState<Page>("home");
  const [seed, setSeed] = useState("12345");
  const [mapId, setMapId] = useState("demo");
  const [roomId, setRoomId] = useState(room.roomId || "table");
  const [note, setNote] = useState("");
  const muted = useSyncExternalStore(subscribeSfx, sfxMuted, () => false);
  const inRoom = room.status === "open" || room.status === "reconnecting";

  const start = () => {
    const n = Math.trunc(Number(seed));
    const version = versions.find((item) => item.id === mapId);
    onNewCampaign(version ? playChoiceFromVersion(version) : demoPlayChoice(), Number.isFinite(n) ? n : 12345);
  };

  const readMapFile = (file: File | undefined) => {
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed: unknown = JSON.parse(String(reader.result ?? ""));
        if (!isDict(parsed)) {
          setNote("That file is not a map.");
          return;
        }
        const name = file.name.replace(/\.json$/i, "") || "Imported map";
        const error = onImportMap(name, parsed);
        setNote(error === "" ? `Imported ${name}. Pick it under Scenario.` : error);
      } catch {
        setNote("That file is not map JSON.");
      }
    };
    reader.readAsText(file);
  };

  const readSaveFile = (file: File | undefined) => {
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed: unknown = JSON.parse(String(reader.result ?? ""));
        const save = parseCampaignSave(parsed);
        if (!save) {
          setNote("That file is not a saved game.");
          return;
        }
        onResume(save);
      } catch {
        setNote("That file is not a saved game.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <aside className="main-menu" aria-label="Main menu">
      <header className="main-menu-title">
        <p className="main-menu-kicker">Tactical dossier</p>
        <h1>Strategy Demo</h1>
        <span className="main-menu-badge">v{MENU_VERSION}</span>
      </header>
      {page === "home" && (
        <nav className="main-menu-nav" aria-label="Menu">
          <button type="button" className="primary" onClick={() => setPage("new")}>
            New Campaign
          </button>
          <button type="button" onClick={() => setPage("load")} disabled={saves.length === 0}>
            Continue / Load Save
          </button>
          <button type="button" onClick={() => setPage("online")}>
            Multiplayer
          </button>
          <button type="button" onClick={onOpenEditor}>
            Map Editor
          </button>
          <button type="button" onClick={() => setPage("settings")}>
            Settings
          </button>
          <p className="muted">Board on the glass: {mapName}</p>
        </nav>
      )}
      {page === "new" && (
        <form
          className="main-menu-page"
          onSubmit={(event) => {
            event.preventDefault();
            start();
          }}
        >
          <h2>New campaign</h2>
          <label>
            Scenario
            <select aria-label="Scenario" value={mapId} onChange={(event) => setMapId(event.target.value)}>
              <option value="demo">Demo map</option>
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.name}
                </option>
              ))}
            </select>
          </label>
          <label className="editor-start-file">
            Custom map JSON
            <input type="file" accept="application/json,.json" aria-label="Custom map JSON" onChange={(event) => readMapFile(event.target.files?.[0])} />
          </label>
          <label>
            Your power
            <select aria-label="Your power" value={playerFaction} onChange={(event) => onPlayerFaction(event.target.value)}>
              {FACTIONS.map((faction) => (
                <option key={faction} value={faction}>
                  {factionName(faction)}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">Hot-seat. Every power still takes its turn. This marks the one you are playing.</p>
          <label>
            Seed
            <input aria-label="Seed" value={seed} onChange={(event) => setSeed(event.target.value)} />
          </label>
          {note !== "" && <p className="warn">{note}</p>}
          <button type="submit" className="primary">
            Begin
          </button>
          <button type="button" onClick={() => setPage("home")}>
            Back
          </button>
        </form>
      )}
      {page === "load" && (
        <div className="main-menu-page">
          <h2>Continue</h2>
          <button type="button" onClick={onSaveNow}>
            Save current game
          </button>
          <label className="editor-start-file">
            Load save JSON
            <input type="file" accept="application/json,.json" aria-label="Load save JSON" onChange={(event) => readSaveFile(event.target.files?.[0])} />
          </label>
          <ul className="main-menu-saves">
            {saves.map((save) => (
              <li key={`${save.label}-${save.savedAt}`}>
                <button type="button" onClick={() => onResume(save)}>
                  {save.label}
                </button>
              </li>
            ))}
          </ul>
          {note !== "" && <p className="warn">{note}</p>}
          <button type="button" onClick={() => setPage("home")}>
            Back
          </button>
        </div>
      )}
      {page === "online" && (
        <div className="main-menu-page">
          <h2>Multiplayer</h2>
          <p className="muted">Status: {room.status}</p>
          <label>
            Room
            <input aria-label="Room" value={roomId} spellCheck={false} onChange={(event) => setRoomId(event.target.value)} />
          </label>
          <button type="button" className="primary" onClick={() => room.connect(roomId)}>
            Connect
          </button>
          {inRoom && (
            <button type="button" onClick={() => room.disconnect()}>
              Leave
            </button>
          )}
          <div className="main-menu-seats">
            <button type="button" disabled={!inRoom} onClick={() => room.claim("axis")}>
              Claim Axis
            </button>
            <button type="button" disabled={!inRoom} onClick={() => room.claim("allies")}>
              Claim Allies
            </button>
          </div>
          {inRoom && (
            <button type="button" className="primary" onClick={start}>
              Enter table
            </button>
          )}
          <button type="button" onClick={() => setPage("home")}>
            Back
          </button>
        </div>
      )}
      {page === "settings" && (
        <div className="main-menu-page">
          <h2>Settings</h2>
          <label>
            Music {Math.round(volume * 100)}
            <input
              type="range"
              min={0}
              max={100}
              aria-label="Music volume"
              value={Math.round(volume * 100)}
              onChange={(event) => onVolume(Number(event.target.value) / 100)}
            />
          </label>
          <button type="button" aria-pressed={muted} onClick={() => toggleSfx()}>
            Effects {muted ? "off" : "on"}
          </button>
          <div className="main-menu-seats" role="group" aria-label="Visual style">
            <button type="button" className={look === "field" ? "active" : ""} onClick={() => onLook("field")}>
              Field
            </button>
            <button type="button" className={look === "dusk" ? "active" : ""} onClick={() => onLook("dusk")}>
              Dusk
            </button>
          </div>
          <button type="button" onClick={() => setPage("home")}>
            Back
          </button>
        </div>
      )}
    </aside>
  );
}
