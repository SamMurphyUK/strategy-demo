import { useRef, useState } from "react";
import type { SculptTool } from "./landmass";
import type { EditorTool, MapEditor, StrokeTolerance } from "./useMapEditor";

const TOOLS: { tool: EditorTool; label: string; key: string; title: string }[] = [
  { tool: "select", label: "Select", key: "S", title: "Click a region to inspect it. Drag its amber diamond to move the unit anchor." },
  { tool: "vertex", label: "Vertex", key: "V", title: "Drag square handles to reshape (shared borders move together). Click a + to insert a vertex." },
  { tool: "knife", label: "Knife", key: "K", title: "Click a line across a region, then Enter or double-click to split it in two." },
  { tool: "merge", label: "Merge", key: "M", title: "Click a region, Shift-click every region to join it (touching or not), then Merge Regions." },
  { tool: "draw", label: "Draw", key: "D", title: "Click vertices for a new region in this layer." },
  { tool: "link", label: "Link", key: "L", title: "Click two regions to add or remove a neighbor link." },
  { tool: "promote", label: "Promote", key: "P", title: "Click bare, decorative land to turn that island into a playable region." },
  { tool: "lattice", label: "Lattice", key: "G", title: "Paint the selected sea zone on the 8×8 grid. Square or triangle. Right-drag or Alt-drag erases. Shift holds the triangle brush." },
];

const SCULPT_HINTS: Record<SculptTool, string> = {
  pen: "Click vertices, or drag a freehand outline. Click the first point, double-click, or press Enter to close it.",
  blob: "Drag to stamp an island. A click drops one circle. Overlaps weld when you bake.",
  select: "Drag a shape to move it. The cream square scales it, the cream ring above it rotates it.",
  vertex: "Drag a square to move that point. Click an edge midpoint to insert one.",
};

const HINTS: Record<EditorTool, string> = {
  select: "Click a region to edit it. Drag the amber diamond to move its unit anchor.",
  vertex: "Drag a square to reshape. A shared border moves every region on it. Click a + to add a vertex. Shift-click a shared border to roughen it.",
  knife: "Drag a border from coast to coast and release to cut (an end stopping within 25px of the edge still reaches it). Draw a closed loop to carve out an inland country. Or click points, then press Enter or double-click. Alt-drag pans.",
  merge: "Click a region, then Shift-click any number of others of the same type, then press Merge Regions. Islands across water become one territory.",
  draw: "Click to place vertices. Click the first vertex, double-click or press Enter to finish.",
  link: "Click region A, then region B, to add or remove a neighbor link.",
  prune: "Drag a box over small default islands. Only untouched Territories under the threshold whose anchor is inside the box are pruned. Confirm on the badge, or Esc to cancel.",
  promote: "Click land that no territory covers (a decorative island) to make it a playable region again.",
  lattice: "Press New sea zone, then left-drag to carve it out of the sea around it. Left-drag paints the selected zone. Right-drag or Alt-drag erases. Middle-drag pans. Shift, or Triangle, paints one wedge.",
};

/** Floating controls over the map while the editor is open. */
export function EditorToolbar({ editor }: { editor: MapEditor }) {
  const [confirming, setConfirming] = useState(false);
  const sea = editor.layer === "sea";
  const cutting = editor.tool === "knife" && editor.draft.length > 0;

  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Editor toolbar">
      <div className="editor-toolbar-row">
        <div className="segmented" role="group" aria-label="Stage">
          <button
            type="button"
            className={editor.sculpting ? "active" : ""}
            title="Draw and layer the coast. Cutting waits until you switch to Cut."
            onClick={() => editor.setSculpting(true)}
          >
            Landmass
          </button>
          <button
            type="button"
            className={!editor.sculpting ? "active" : ""}
            title="Slice the coast into territories and sea zones."
            onClick={() => editor.enterCutting()}
          >
            Cut
          </button>
        </div>
        {!editor.sculpting && <OpenCoastButton editor={editor} />}
        <div className="segmented" role="group" aria-label="History">
          <button type="button" onClick={editor.undo} disabled={!editor.canUndo} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button type="button" onClick={editor.redo} disabled={!editor.canRedo} title="Redo (Ctrl+Shift+Z)">
            Redo
          </button>
        </div>
      </div>
      {editor.sculpting ? (
        <LandmassRow editor={editor} />
      ) : (
      <>
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
          {TOOLS.filter((t) => t.tool !== "lattice" || sea).map((t) => (
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
          <div className="segmented" role="group" aria-label="Prune">
            <button
              type="button"
              className={editor.tool === "prune" ? "active" : ""}
              title="Drag a box over the islands to prune, then confirm (B). Only untouched Territories under the threshold with their anchor inside the box are removed."
              onClick={() => editor.setTool("prune")}
            >
              Prune Box <kbd>B</kbd>
            </button>
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
          </div>
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
        {editor.tool === "lattice" && (
          <div className="segmented" role="group" aria-label="Lattice brush">
            <button
              type="button"
              className={editor.latticeBrush === "square" && !editor.latticeShift ? "active" : ""}
              title="Paint a whole 8×8 square."
              onClick={() => editor.setLatticeBrush("square")}
            >
              Square
            </button>
            <button
              type="button"
              className={editor.latticeBrush === "triangle" || editor.latticeShift ? "active" : ""}
              title="Paint one diagonal wedge. Hold Shift to use this brush without switching."
              onClick={() => editor.setLatticeBrush("triangle")}
            >
              Triangle
            </button>
            <button
              type="button"
              title="Add an empty sea zone and select it. Painting then takes squares from the zones around it."
              onClick={editor.newSeaZone}
            >
              New sea zone
            </button>
          </div>
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
        <button
          type="button"
          className={editor.showUncovered ? "active" : ""}
          aria-pressed={editor.showUncovered}
          title="Outline land-mask pieces no land region cutter covers, in orange and magenta."
          onClick={editor.toggleUncovered}
        >
          [ Show Uncovered Land ]
        </button>
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
      </>
      )}
      <p className="editor-toolbar-hint">
        {editor.status !== "" ? editor.status : editor.sculpting ? SCULPT_HINTS[editor.sculptTool] : HINTS[editor.tool]}
      </p>
    </div>
  );
}

const SCULPT_TOOLS: { tool: SculptTool; label: string }[] = [
  { tool: "pen", label: "Pen" },
  { tool: "blob", label: "Blob" },
  { tool: "select", label: "Transform" },
  { tool: "vertex", label: "Vertex" },
];

function OpenCoastButton({ editor }: { editor: MapEditor }) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        title="Install a landmass SVG as the coast and slice that shape."
        onClick={() => fileRef.current?.click()}
      >
        Open landmass SVG
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".svg,image/svg+xml"
        aria-label="Open landmass SVG"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) {
            return;
          }
          void file.text().then((text) => editor.openCoastSvg(text));
        }}
      />
    </>
  );
}

function LandmassRow({ editor }: { editor: MapEditor }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = editor.sculptShapes.find((shape) => shape.id === editor.sculptSelectedId) ?? null;
  return (
    <div className="editor-toolbar-row">
          <div className="segmented" role="group" aria-label="Draft shape">
            {SCULPT_TOOLS.map((item) => (
              <button
                key={item.tool}
                type="button"
                className={editor.sculptTool === item.tool ? "active" : ""}
                onClick={() => editor.setSculptTool(item.tool)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {editor.sculptTool === "blob" && (
            <label className="editor-toolbar-note" title="Radius of each stamped circle, in world units.">
              Radius
              <input
                type="range"
                min={4}
                max={36}
                step={1}
                value={editor.blobRadius}
                aria-label="Blob radius"
                onChange={(e) => editor.setBlobRadius(Number(e.target.value))}
              />
            </label>
          )}
          <label className="editor-toolbar-note" title="Ramer-Douglas-Peucker tolerance. Higher drops more points.">
            Simplify
            <input
              type="range"
              min={0.5}
              max={8}
              step={0.5}
              value={editor.sculptTolerance}
              aria-label="Simplify tolerance"
              onChange={(e) => editor.setSculptTolerance(Number(e.target.value))}
            />
          </label>
          <button type="button" disabled={!selected} onClick={editor.toggleSculptHole}>
            {selected?.hole ? "Make land" : "Make hole"}
          </button>
          <button type="button" disabled={!selected} onClick={editor.deleteSculptShape}>
            Delete shape
          </button>
          <button type="button" onClick={() => fileRef.current?.click()}>
            Import SVG
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".svg,image/svg+xml"
            aria-label="Import SVG paths"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) {
                return;
              }
              void file.text().then((text) => editor.importSculptSvg(text));
            }}
          />
          <button type="button" disabled={editor.sculptShapes.length === 0} onClick={editor.bakeSculpt}>
            Bake
          </button>
          <button type="button" disabled={editor.sculptShapes.length === 0} onClick={editor.downloadLandmassSvg}>
            Download .svg
          </button>
          <button
            type="button"
            className="primary"
            disabled={editor.sculptShapes.length === 0}
            title="Bake this coast and open Cut. A changed coast replaces the territories. Undo brings them back."
            onClick={editor.enterCutting}
          >
            Cut this landmass
          </button>
    </div>
  );
}
