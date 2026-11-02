import { useState, useSyncExternalStore, type CSSProperties } from "react";
import { ALL_AUDIO_FILES, BATTLE_CUES, SOUND_CUES, type SoundCue } from "../../audio/audio_manifest";
import {
  assignedFiles,
  assignFileToCue,
  clearCueOverride,
  cueMapJson,
  cueRevisionNow,
  setSoundboardOpen,
  soundboardVisible,
  soundManager,
  subscribeCueMap,
  subscribeSoundboard,
} from "../../audio/sound_manager";
import { previewBattleCue } from "../battle/utils/helper";

const panel: CSSProperties = {
  position: "fixed",
  top: 12,
  right: 12,
  zIndex: 1200,
  width: "min(440px, calc(100vw - 24px))",
  maxHeight: "calc(100vh - 24px)",
  overflow: "auto",
  background: "#3B333A",
  color: "#F4EFE2",
  border: "1px solid #7A684B",
  padding: 12,
  font: "12px/1.35 ui-monospace, monospace",
};

const row: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto 1fr",
  gap: "4px 8px",
  alignItems: "start",
  padding: "6px 0",
  borderTop: "1px solid #7A684B",
};

const chip: CSSProperties = {
  background: "#3B333A",
  color: "#F4EFE2",
  border: "1px solid #7A684B",
  padding: "2px 6px",
  cursor: "pointer",
  font: "inherit",
};

const battleCues = new Set<string>(BATTLE_CUES);

function CueRows({ cues, battle = false }: { cues: readonly SoundCue[]; battle?: boolean }) {
  const [cleared, setCleared] = useState<string | null>(null);
  return cues.map((cue) => {
    const files = assignedFiles(cue);
    const clearCue = () => {
      clearCueOverride(cue);
      setCleared(cue);
      window.setTimeout(() => {
        setCleared((current) => (current === cue ? null : current));
      }, 900);
    };
    return (
      <div key={cue} style={row}>
        <button
          type="button"
          style={chip}
          onClick={() => {
            soundManager.unlock();
            if (battle && cue !== "assign_casualty") previewBattleCue(cue);
            else soundManager.play(cue);
          }}
        >
          [ ▶ Test ]
        </button>
        <div>
          <div>{cue}</div>
          {files.length > 0 && <div style={{ color: "#CDB892" }}>{files.join(" · ")}</div>}
          {battle && (
            <button type="button" style={{ ...chip, marginTop: 4 }} onPointerDown={clearCue}>
              {cleared === cue ? "Cleared" : "Clear cue"}
            </button>
          )}
        </div>
      </div>
    );
  });
}

export function Soundboard() {
  const open = useSyncExternalStore(subscribeSoundboard, soundboardVisible, () => false);
  const revision = useSyncExternalStore(subscribeCueMap, cueRevisionNow, () => 0);
  const [copied, setCopied] = useState(false);
  if (!open) return null;

  const copyMap = () => {
    const text = cueMapJson();
    const clipboard = navigator.clipboard;
    if (!clipboard) return;
    void clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <aside role="dialog" aria-label="Soundboard" style={panel} data-revision={revision}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <strong>Soundboard</strong>
        <span>
          <button type="button" style={chip} onClick={copyMap}>
            {copied ? "Copied" : "Copy cue map"}
          </button>{" "}
          <button type="button" style={chip} onClick={() => setSoundboardOpen(false)}>
            Close
          </button>
        </span>
      </div>
      <p style={{ margin: "8px 0", color: "#7A684B" }}>Shift+A closes this drawer. M toggles mute.</p>
      <h2 style={{ font: "inherit", margin: "10px 0 0" }}>Cues</h2>
      <CueRows cues={SOUND_CUES.filter((cue) => !battleCues.has(cue))} />
      <h2 style={{ font: "inherit", margin: "14px 0 0" }}>Battle</h2>
      <p style={{ margin: "8px 0", color: "#7A684B" }}>
        Assign a file to replace one battle tone. Clear cue removes that file, and the original tone plays. assign_casualty can be retargeted, and the battle does not play it yet.
      </p>
      <CueRows cues={BATTLE_CUES} battle />
      <h2 style={{ font: "inherit", margin: "14px 0 0" }}>All files</h2>
      {ALL_AUDIO_FILES.map((file) => (
        <div key={file} style={row}>
          <button
            type="button"
            style={chip}
            onClick={() => {
              soundManager.unlock();
              soundManager.previewFile(file);
            }}
          >
            [ ▶ Play ]
          </button>
          <div>
            <div>{file}</div>
            <select
              aria-label={`Assign ${file}`}
              defaultValue=""
              style={{ ...chip, marginTop: 4, maxWidth: "100%" }}
              onChange={(event) => {
                const cue = event.target.value as SoundCue;
                if (cue) assignFileToCue(cue, file);
                event.target.value = "";
              }}
            >
              <option value="">Assign to cue…</option>
              {SOUND_CUES.map((cue) => (
                <option key={cue} value={cue}>
                  {cue}
                </option>
              ))}
            </select>
          </div>
        </div>
      ))}
    </aside>
  );
}
