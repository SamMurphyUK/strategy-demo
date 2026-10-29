import { useState } from "react";
import type { EditorTool, MapEditor, StrokeTolerance } from "./useMapEditor";

const TOOLS: { tool: EditorTool; label: string; key: string; title: string }[] = [
  { tool: "select", label: "Select", key: "S", title: "Click a region to inspect it. Drag its amber diamond to move the unit anchor." },
  { tool: "vertex", label: "Vertex", key: "V", title: "Drag square handles to reshape (shared borders move together). Click a + to insert a vertex." },
  { tool: "knife", label: "Knife", key: "K", title: "Click a line across a region, then Enter or double-click to split it in two." },
  { tool: "merge", label: "Merge", key: "M", title: "Click a region, Shift-click every region to join it (touching or not), then Merge Regions." },
  { tool: "draw", label: "Draw", key: "D", title: "Click vertices for a new region in this layer." },
  { tool: "link", label: "Link", key: "L", title: "Click two regions to add or remove a neighbor link." },
  { tool: "promote", label: "Promote", key: "P", title: "Click bare, decorative land to turn that island into a playable region." },
];

const HINTS: Record<EditorTool, string> = {
  select: "Click a region to edit it. Drag the amber diamond to move its unit anchor.",
  vertex: "Drag a square to reshape. A shared border moves every region on it. Click a + to add a vertex. Shift-click a shared border to roughen it.",
  knife: "Drag a border from coast to coast and release to cut (an end stopping within 25px of the edge still reaches it). Draw a closed loop to carve out an inland country. Or click points, then press Enter or double-click. Alt-drag pans.",
  merge: "Click a region, then Shift-click any number of others of the same type, then press Merge Regions. Islands across water become one territory.",
  draw: "Click to place vertices. Click the first vertex, double-click or press Enter to finish.",
  link: "Click region A, then region B, to add or remove a neighbor link.",
  promote: "Click land that no territory covers (a decorative island) to make it a playable region again.",
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
            title="Fill whatever part of this layer no region covers with one block per landmass (or ocean), shaped like its real coast, ready to slice with the knife."
            onClick={() => setConfirming(true)}
          >
            Reset to Master Block
          </button>
        )}
        {!sea && (
          <>
            <button
              type="button"
              disabled={editor.pruneCount === 0}
              title="Remove every untouched Territory (default name, Neutral, no units or factory) whose visible area is under the threshold. The land stays on the map as decorative terrain; sea zones still stop at its coast."
              onClick={editor.pruneSmallIslands}
            >
              Prune Small Islands (&lt; {editor.pruneArea}) {editor.pruneCount > 0 ? `\u2192 ${editor.pruneCount}` : ""}
            </button>
            <input
              type="range"
              min={1}
              max={300}
              step={1}
              value={editor.pruneArea}
              aria-label="Prune area threshold"
              title={`Prune threshold: ${editor.pruneArea} world square units`}
              onChange={(e) => editor.setPruneArea(Number(e.target.value))}
            />
          </>
        )}
        {editor.tool === "knife" && (
          <>
            <label className="editor-toolbar-note" title="How far a freehand stroke is simplified. Smoother means fewer vertices.">
              Trace{" "}
              <select
                value={editor.strokeTolerance}
                onChange={(e) => editor.setStrokeTolerance(e.target.value as StrokeTolerance)}
              >
                <option value="fine">Fine (1.5px)</option>
                <option value="medium">Medium (3px)</option>
                <option value="smooth">Smooth (5px)</option>
              </select>
            </label>
            <label className="editor-toolbar-note" title="One Chaikin corner-cutting pass before simplifying, so curves read as hand drawn.">
              <input type="checkbox" checked={editor.strokeSmooth} onChange={(e) => editor.setStrokeSmooth(e.target.checked)} /> Round
              curves
            </label>
          </>
        )}
        {editor.tool === "vertex" && (
          <button
            type="button"
            disabled={!editor.selected}
            title="Turn the straight borders of the selected region (or just the one it shares with the Shift-picked region) into winding 5 to 7 point borders. Neighbors move with it."
            onClick={editor.roughenSelected}
          >
            Roughen Border
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
              {[editor.selected, ...editor.mergeWith].map((r) => r.id).join(" + ")}
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
