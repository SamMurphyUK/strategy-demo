import { useState } from "react";
import { useSyncExternalStore } from "react";
import { sfxMuted, subscribeSfx, toggleSfx } from "../../../audio/sound_manager";
import { BOARD_VIEW_LABEL, BOARD_VIEWS, type BoardView } from "../boardView";
import type { MapVersion } from "../editor/mapVersions";
import { demoPlayChoice, playChoiceFromVersion, type PlayChoice } from "../session/play_map";
import type { RoomControls } from "../session/use_campaign_session";
import { parseCampaignSave, type CampaignSave } from "./campaignSave";
import { draftLaunch, RuleBadges, type CampaignDraft } from "./NewCampaignModal";
import type { CampaignLaunchConfig } from "../../../engine/types/ruleset";

export const MENU_VERSION = "0.1.0";

type Page = "home" | "load" | "online" | "settings";

export function MainMenu({
  mapName,
  versions,
  saves,
  room,
  volume,
  look,
  draft,
  board,
  onBoard,
  onOpenBoard,
  onOpenCampaign,
  onNewCampaign,
  onResume,
  onSaveNow,
  onOpenEditor,
}: {
  mapName: string;
  versions: MapVersion[];
  saves: CampaignSave[];
  room: RoomControls;
  volume: number;
  look: "field" | "dusk";
  draft: CampaignDraft;
  /** The board the campaign is drawn on. */
  board: BoardView;
  /** Switch boards and stay in the menu. */
  onBoard(view: BoardView): void;
  /** Switch boards and close the menu onto the game on the glass. */
  onOpenBoard(view: BoardView): void;
  onOpenCampaign(): void;
  onNewCampaign(choice: PlayChoice, seed: number, launch?: CampaignLaunchConfig): void;
  onResume(save: CampaignSave): void;
  onSaveNow(): void;
  onOpenEditor(): void;
}) {
  const [page, setPage] = useState<Page>("home");
  const [roomId, setRoomId] = useState(room.roomId || "table");
  const [note, setNote] = useState("");
  const muted = useSyncExternalStore(subscribeSfx, sfxMuted, () => false);
  const inRoom = room.status === "open" || room.status === "reconnecting";
  const tableLaunch = room.launch ?? draftLaunch(draft);

  const start = () => {
    const n = Math.trunc(Number(draft.seed));
    const version = versions.find((item) => item.id === draft.mapId);
    onNewCampaign(version ? playChoiceFromVersion(version) : demoPlayChoice(), Number.isFinite(n) ? n : 12345, draftLaunch(draft));
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
          <button type="button" className="primary" onClick={onOpenCampaign}>
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
          <button type="button" onClick={() => window.location.assign("/?bake=1")}>
            Sprite editor
          </button>
          <button type="button" title="The master 3D board: raised land, sea zones, and a disc for each force" onClick={() => onOpenBoard("vanilla")}>
            Vanilla
          </button>
          <button type="button" title="The vanilla board with the Shogun II art pass" onClick={() => onOpenBoard("shogun")}>
            Shogun
          </button>
          <button type="button" onClick={() => setPage("settings")}>
            Settings
          </button>
          <p className="muted">Board on the glass: {mapName}</p>
        </nav>
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
          <button type="button" className="primary" onClick={() => room.connect(roomId, draftLaunch(draft))}>
            Connect
          </button>
          <RuleBadges launch={tableLaunch} />
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
          <div className="main-menu-seats" role="group" aria-label="Board">
            {BOARD_VIEWS.map((view) => (
              <button key={view} type="button" className={board === view ? "active" : ""} onClick={() => onBoard(view)}>
                {BOARD_VIEW_LABEL[view]}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setPage("home")}>
            Back
          </button>
        </div>
      )}
    </aside>
  );
}
