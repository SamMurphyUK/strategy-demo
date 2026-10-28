import { useState } from "react";
import { LINK_COLORS } from "../mapRenderer";
import { neighborsOf, OWNER_OPTIONS } from "./editorModel";
import type { EditorTool, MapEditor } from "./useMapEditor";

const TOOL_HINTS: Record<EditorTool, string> = {
  select:
    "Click a region to inspect it. Drag its square handles to reshape (shared borders move together) and the amber diamond to move its unit anchor.",
  draw: "Click to place vertices. Clicks within 8 px of an existing vertex or edge snap to it. Click the first vertex, double-click or press Enter to finish.",
  link: "Click region A, then region B, to add or remove a neighbor link between them. Use it for straits, canals and other edge cases.",
};

/** Commits on blur or Enter, so typing does not create an undo step per keystroke. */
function CommitInput(props: {
  value: string | number;
  type?: "text" | "number";
  step?: number;
  onCommit(value: string): void;
}) {
  return (
    <input
      key={String(props.value)}
      className={props.type === "number" ? "mono" : undefined}
      type={props.type ?? "text"}
      step={props.step}
      defaultValue={props.value}
      onBlur={(e) => {
        if (e.target.value !== String(props.value)) {
          props.onCommit(e.target.value);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function EditorPanel({ editor }: { editor: MapEditor }) {
  const [renameError, setRenameError] = useState("");
  const { selected, map } = editor;
  const num = (value: string, fallback: number) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

  return (
    <>
      <section className="panel editor-panel">
        <h2>Map editor</h2>
        <div className="tool-row" role="toolbar" aria-label="Editor tools">
          {(["select", "draw", "link"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={editor.tool === t ? "active" : ""}
              onClick={() => editor.setTool(t)}
            >
              {t === "select" ? "Select" : t === "draw" ? "Draw" : "Link"}
            </button>
          ))}
        </div>
        {editor.tool === "draw" && (
          <div className="tool-row">
            <button type="button" className={editor.drawSea ? "" : "active"} onClick={() => editor.setDrawSea(false)}>
              Land region
            </button>
            <button type="button" className={editor.drawSea ? "active" : ""} onClick={() => editor.setDrawSea(true)}>
              Sea zone
            </button>
          </div>
        )}
        {editor.tool === "draw" && editor.draft.length > 0 && (
          <div className="tool-row">
            <button type="button" className="primary" onClick={editor.finishDraft} disabled={editor.draft.length < 3}>
              Finish ({editor.draft.length})
            </button>
            <button type="button" onClick={editor.undoVertex}>
              Back
            </button>
            <button type="button" onClick={editor.cancelDraft}>
              Cancel
            </button>
          </div>
        )}
        <p className="muted editor-hint">{TOOL_HINTS[editor.tool]}</p>
        {editor.tool === "link" && editor.linkFirstId !== "" && (
          <p className="budget">
            Linking from <strong>{editor.linkFirstId}</strong>. Click the second region.
          </p>
        )}
        <div className="tool-row">
          <button type="button" onClick={editor.undo} disabled={!editor.canUndo}>
            Undo
          </button>
          <button type="button" onClick={editor.redo} disabled={!editor.canRedo}>
            Redo
          </button>
        </div>
      </section>

      <section className="panel editor-panel">
        <h2>{selected ? selected.id : "Region"}</h2>
        {!selected ? (
          <p className="muted">Select a region on the map to edit its metadata.</p>
        ) : (
          <div className="field-grid">
            <label>
              Id
              <CommitInput
                value={selected.id}
                onCommit={(v) => {
                  setRenameError(editor.rename(v));
                }}
              />
            </label>
            {renameError !== "" && <p className="warn field-wide">{renameError}</p>}
            <label>
              Name
              <CommitInput value={selected.name} onCommit={(v) => editor.patchSelected({ name: v })} />
            </label>
            <label>
              IPC value
              <CommitInput
                type="number"
                value={selected.ipc_value}
                onCommit={(v) => editor.patchSelected({ ipc_value: Math.max(0, Math.trunc(num(v, selected.ipc_value))) })}
              />
            </label>
            <label>
              Starting owner
              <select
                value={selected.starting_owner}
                onChange={(e) => editor.patchSelected({ starting_owner: e.target.value })}
              >
                {[...new Set([...OWNER_OPTIONS, selected.starting_owner])].map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={selected.is_sea}
                onChange={(e) => editor.patchSelected({ is_sea: e.target.checked })}
              />
              Sea zone
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={selected.factory}
                onChange={(e) => editor.patchSelected({ factory: e.target.checked })}
              />
              Factory
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={selected.capital}
                onChange={(e) => editor.patchSelected({ capital: e.target.checked })}
              />
              Capital / victory
            </label>
            <label>
              Anchor x (cx)
              <CommitInput
                type="number"
                step={0.5}
                value={Math.round(selected.cx * 100) / 100}
                onCommit={(v) => editor.patchSelected({ cx: num(v, selected.cx) })}
              />
            </label>
            <label>
              Anchor y (cy)
              <CommitInput
                type="number"
                step={0.5}
                value={Math.round(selected.cy * 100) / 100}
                onCommit={(v) => editor.patchSelected({ cy: num(v, selected.cy) })}
              />
            </label>
            <p className="muted field-wide mono">{selected.polygon.length} vertices</p>
            <button type="button" className="field-wide danger" onClick={editor.removeSelected}>
              Delete region
            </button>
          </div>
        )}
      </section>

      <section className="panel editor-panel">
        <h2>Neighbors</h2>
        <button type="button" className="primary" onClick={editor.calculateNeighbors}>
          Calculate Neighbors
        </button>
        <ul className="legend">
          {(["land", "sea", "coastal"] as const).map((kind) => (
            <li key={kind}>
              <span className="swatch" style={{ borderColor: LINK_COLORS[kind] }} />
              {kind === "land" ? "Land to land" : kind === "sea" ? "Sea to sea" : "Coastal"}
              <b className="mono">{editor.linkCounts[kind]}</b>
            </li>
          ))}
        </ul>
        {selected && (
          <>
            <p className="muted">{selected.id} borders:</p>
            {neighborsOf(map, selected.id).length === 0 ? (
              <p className="muted">None. Use Calculate Neighbors or the Link tool.</p>
            ) : (
              <ul className="chip-list">
                {neighborsOf(map, selected.id).map((id) => (
                  <li key={id}>
                    <button type="button" title={`Remove link to ${id}`} onClick={() => editor.unlink(selected.id, id)}>
                      {id} <span aria-hidden="true">{"\u00d7"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="panel editor-panel">
        <h2>Export</h2>
        <div className="tool-row">
          <button type="button" className="primary" onClick={editor.exportJson}>
            Export Map JSON
          </button>
          <button type="button" onClick={editor.resetToDemo}>
            Reset to demo map
          </button>
        </div>
        {editor.status !== "" && <p className="muted editor-status">{editor.status}</p>}
        <p className="muted editor-hint">
          Edits autosave in this browser. The running game still uses the demo map until the exported file replaces
          demomap01.json.
        </p>
      </section>
    </>
  );
}
