import { useState } from "react";
import type { EditorTool, MapEditor } from "./useMapEditor";

const TOOLS: { tool: EditorTool; label: string; key: string; title: string }[] = [
  { tool: "select", label: "Select", key: "S", title: "Click a region to inspect it. Drag its amber diamond to move the unit anchor." },
  { tool: "vertex", label: "Vertex", key: "V", title: "Drag square handles to reshape (shared borders move together). Click a + to insert a vertex." },
  { tool: "knife", label: "Knife", key: "K", title: "Click a line across a region, then Enter or double-click to split it in two." },
  { tool: "merge", label: "Merge", key: "M", title: "Click a region, Shift-click its neighbor, then Merge Regions." },
  { tool: "draw", label: "Draw", key: "D", title: "Click vertices for a new region in this layer." },
  { tool: "link", label: "Link", key: "L", title: "Click two regions to add or remove a neighbor link." },
];

const HINTS: Record<EditorTool, string> = {
  select: "Click a region to edit it. Drag the amber diamond to move its unit anchor.",
  vertex: "Drag a square to reshape. A shared border moves every region on it. Click a + to add a vertex.",
  knife: "Drag a straight line across a region to cut it. Or click points for a bent line, then press Enter or double-click. Alt-drag pans.",
  merge: "Click a region, then Shift-click a neighbor of the same type, then press Merge Regions.",
  draw: "Click to place vertices. Click the first vertex, double-click or press Enter to finish.",
  link: "Click region A, then region B, to add or remove a neighbor link.",
};

/** Floating controls over the map while the editor is open. */
export function EditorToolbar({ editor }: { editor: MapEditor }) {
  const [confirming, setConfirming] = useState(false);
  const sea = editor.layer === "sea";
  const cutting = editor.tool === "knife" && editor.draft.length > 0;

  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Editor toolbar">
      <div className="editor-toolbar-row">
        <div className="segmented" role="group" aria-label="Layer">
          <button
            type="button"
            className={!sea ? "active" : ""}
            title="Edit Land Regions (!is_sea). Sea zones are dimmed and cannot be clicked."
            onClick={() => editor.setLayer("land")}
          >
            Land mode
          </button>
          <button
            type="button"
            className={sea ? "active" : ""}
            title="Edit Sea Zones (is_sea). Land regions are dimmed and cannot be clicked."
            onClick={() => editor.setLayer("sea")}
          >
            Sea mode
          </button>
        </div>
        <div className="segmented" role="group" aria-label="Tool">
          {TOOLS.map((t) => (
            <button
              key={t.tool}
              type="button"
              className={editor.tool === t.tool ? "active" : ""}
              title={`${t.title} (${t.key})`}
              onClick={() => editor.setTool(t.tool)}
            >
              {t.label} <kbd>{t.key}</kbd>
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="History">
          <button type="button" onClick={editor.undo} disabled={!editor.canUndo} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button type="button" onClick={editor.redo} disabled={!editor.canRedo} title="Redo (Ctrl+Shift+Z)">
            Redo
          </button>
        </div>
      </div>

      <div className="editor-toolbar-row">
        {confirming ? (
          <>
            <span className="editor-toolbar-note">
              Turn every unallocated {sea ? "sea" : "land"} area into a master block?
            </span>
            <button
              type="button"
              className="primary"
              onClick={() => {
                setConfirming(false);
                editor.addMasterBlock();
              }}
            >
              Yes, add blocks
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            title="Fill whatever part of this layer no region covers with a full-size block, ready to slice with the knife."
            onClick={() => setConfirming(true)}
          >
            Reset to Master Block
          </button>
        )}
        {cutting && (
          <>
            <button type="button" className="primary" onClick={editor.finishDraft} disabled={editor.draft.length < 2}>
              Cut ({editor.draft.length} pts)
            </button>
            <button type="button" onClick={editor.undoVertex}>
              Back
            </button>
            <button type="button" onClick={editor.cancelDraft}>
              Cancel
            </button>
          </>
        )}
        {editor.second && editor.selected && (
          <>
            <button type="button" className="primary" onClick={editor.mergeSelected}>
              Merge Regions
            </button>
            <span className="editor-toolbar-note">
              {editor.selected.id} + {editor.second.id}
            </span>
            <button type="button" onClick={editor.clearSecond}>
              Clear
            </button>
          </>
        )}
      </div>
      <p className="editor-toolbar-hint">{editor.status !== "" ? editor.status : HINTS[editor.tool]}</p>
    </div>
  );
}
