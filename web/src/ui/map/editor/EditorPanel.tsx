import { useState } from "react";
import { VERSION_NAME_MAX } from "./mapVersions";
import { factionIdFromDisplay } from "../../../content/game_scene_session_builder";
import { unitSlotMax } from "../geometry";
import { LINK_COLORS } from "../mapRenderer";
import { unitLabel } from "../unitStacks";
import {
  FACTORY_LEVELS,
  type FactoryLevel,
  neighborsOf,
  OWNER_OPTIONS,
  sampleGarrison,
  UNIT_FACTION_OPTIONS,
  UNIT_TYPE_OPTIONS,
} from "./editorModel";
import type { MapEditor } from "./useMapEditor";

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

const FACTORY_LABELS: Record<FactoryLevel, string> = { none: "None", minor: "Minor", major: "Major" };

/** Always lists the current value, even if it is not one of the usual options. */
function withCurrent(options: readonly string[], current: string): string[] {
  return [...new Set([...options, current])];
}

export function EditorPanel({ editor }: { editor: MapEditor }) {
  const [renameError, setRenameError] = useState("");
  const { selected, map } = editor;
  const num = (value: string, fallback: number) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const units = editor.selectedUnits;
  const unitRows = units.map(({ faction_id, unit_type_id, count }) => ({ faction_id, unit_type_id, count }));
  const editUnit = (index: number, patch: Partial<(typeof unitRows)[number]>) =>
    editor.setUnits(unitRows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <>
      <section className="panel editor-panel">
        <h2>{selected ? selected.id : "Region"}</h2>
        {!selected ? (
          <p className="muted">
            Click a {editor.layer === "sea" ? "sea zone" : "land region"} on the map to edit it. Use the toolbar over the
            map to slice, reshape or merge.
          </p>
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
              Owner
              <select
                value={selected.starting_owner}
                onChange={(e) => editor.patchSelected({ starting_owner: e.target.value })}
              >
                {withCurrent(OWNER_OPTIONS, selected.starting_owner).map((o) => (
                  <option key={o} value={o}>
                    {o.toUpperCase()}
                  </option>
                ))}
              </select>
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
              Factory
              <select
                value={selected.factory}
                onChange={(e) => editor.patchSelected({ factory: e.target.value as FactoryLevel })}
              >
                {FACTORY_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {FACTORY_LABELS[level]}
                  </option>
                ))}
              </select>
            </label>
            {!selected.is_sea && (
              <>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={selected.has_airbase ?? false}
                    onChange={(e) => editor.patchSelected({ has_airbase: e.target.checked })}
                  />
                  Airbase
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={selected.has_harbour ?? false}
                    onChange={(e) => editor.patchSelected({ has_harbour: e.target.checked })}
                  />
                  Harbour
                </label>
              </>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={selected.capital}
                onChange={(e) => editor.patchSelected({ capital: e.target.checked })}
              />
              Capital
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

            {!selected.is_sea && (
              <div className="field-wide unit-editor">
                <span className="unit-editor-title">Facility anchor</span>
                <p className="muted">
                  {selected.facility_anchor
                    ? "Placed. Drag the magenta BASE marker. One point for the factory, airbase, and harbour."
                    : "Not placed. One magenta BASE marker covers the factory, airbase, and harbour."}
                </p>
                <button type="button" onClick={editor.placeFacilityAnchor} disabled={Boolean(selected.facility_anchor)}>
                  Place Facility Anchor
                </button>
              </div>
            )}

            <div className="field-wide unit-editor">
              <span className="unit-editor-title">Unit slots</span>
              <p className="muted">
                {selected.unit_slots?.length
                  ? `${selected.unit_slots.length} of ${unitSlotMax(selected.is_sea)} placed. Drag S1–S${selected.unit_slots.length}.`
                  : editor.slotCount
                    ? `${editor.slotCount} generated. Add or remove keeps these.`
                    : `Land holds ${unitSlotMax(false)}, sea holds ${unitSlotMax(true)}.`}
              </p>
              <button
                type="button"
                onClick={editor.addUnitSlot}
                disabled={editor.slotCount >= unitSlotMax(selected.is_sea)}
              >
                + Add Unit Slot
              </button>
              <button type="button" onClick={editor.removeLastUnitSlot} disabled={editor.slotCount === 0}>
                − Remove Last Slot
              </button>
              <button type="button" onClick={editor.seedUnitSlots}>
                Auto-Seed Slots
              </button>
            </div>

            <button
              type="button"
              className="field-wide"
              disabled={!(selected.facility_anchor || selected.air_anchor || selected.unit_slots)}
              title="Clear the facility anchor and the placed unit slots, so slots are generated again. A saved air anchor is cleared too."
              onClick={() => editor.patchSelected({ facility_anchor: undefined, air_anchor: undefined, unit_slots: undefined })}
            >
              Reset Anchors / Slots
            </button>

            <div className="field-wide unit-editor">
              <span className="unit-editor-title">Starting units</span>
              {unitRows.length === 0 && <p className="muted">None.</p>}
              {unitRows.map((row, i) => (
                <div className="unit-row" key={`${i}-${row.faction_id}-${row.unit_type_id}`}>
                  <select
                    aria-label="Faction"
                    value={row.faction_id}
                    onChange={(e) => editUnit(i, { faction_id: e.target.value })}
                  >
                    {withCurrent(UNIT_FACTION_OPTIONS, row.faction_id).map((f) => (
                      <option key={f} value={f}>
                        {f.toUpperCase()}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Unit type"
                    value={row.unit_type_id}
                    onChange={(e) => editUnit(i, { unit_type_id: e.target.value })}
                  >
                    {withCurrent(UNIT_TYPE_OPTIONS, row.unit_type_id).map((u) => (
                      <option key={u} value={u}>
                        {unitLabel(u)}
                      </option>
                    ))}
                  </select>
                  <CommitInput
                    type="number"
                    value={row.count}
                    onCommit={(v) => editUnit(i, { count: Math.max(0, Math.trunc(num(v, row.count))) })}
                  />
                  <button
                    type="button"
                    title="Remove this line"
                    onClick={() => editor.setUnits(unitRows.filter((_, k) => k !== i))}
                  >
                    {"\u00d7"}
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  const owner = factionIdFromDisplay(selected.starting_owner);
                  editor.setUnits([
                    ...unitRows,
                    {
                      faction_id: owner === "independent" ? "neutral" : owner,
                      unit_type_id: selected.is_sea ? "destroyer" : "infantry",
                      count: 1,
                    },
                  ]);
                }}
              >
                Add units
              </button>
              <div className="unit-editor-quick">
                <button
                  type="button"
                  title={`Six unit types for ${selected.is_sea ? "a sea zone" : "a land territory"}, to see how its slots fit. Replaces the units listed here.`}
                  onClick={() => {
                    const owner = factionIdFromDisplay(selected.starting_owner);
                    // Neutral tokens are plain grey, so a neutral territory's sample wears the Soviet colours.
                    editor.setUnits(sampleGarrison(selected.is_sea, owner === "independent" || owner === "neutral" ? "ussr" : owner));
                  }}
                >
                  Fill Sample Garrison
                </button>
                <button type="button" disabled={unitRows.length === 0} onClick={() => editor.setUnits([])}>
                  Clear units
                </button>
              </div>
            </div>

            <p className="muted field-wide mono">
              {selected.polygon.length} vertices
              {(selected.extra ?? []).length > 0 ? ` \u00b7 ${(selected.extra ?? []).length + 1} islands` : ""}
            </p>
            {(selected.extra ?? []).length > 0 && (
              <button
                type="button"
                className="field-wide"
                title="Break this territory back into one region per island. The main island keeps this id; each other island becomes a new default territory."
                onClick={editor.splitIslands}
              >
                Unmerge / Split Islands
              </button>
            )}
            {!selected.is_sea && (
              <button
                type="button"
                className="field-wide"
                title="Remove this region from play (Delete or Backspace). The land stays on the map as plain terrain with no id, IPC or selection box. The Promote tool brings it back."
                onClick={editor.makeDecorative}
              >
                Mark as Decorative (Unplayable)
              </button>
            )}
            <button
              type="button"
              className="field-wide danger"
              title="Give this region's space back to the neighbor it shares a border with, so that border comes off the map. A region with no neighbor leaves a gap; Reset to Master Block fills it."
              onClick={editor.removeSelected}
            >
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

      <VersionLibrary editor={editor} />

      <section className="panel editor-panel">
        <h2>Export</h2>
        <div className="export-buttons">
          <button type="button" className="primary" onClick={editor.exportJson}>
            Recalculate All Adjacencies &amp; Download JSON
          </button>
          <button type="button" className="primary" onClick={editor.saveToDevServer}>
            Save Directly to Dev Server
          </button>
          <button type="button" onClick={editor.resetToDemo}>
            Reset to demo map
          </button>
        </div>
        <p className="muted editor-hint">
          Edits autosave in this browser. Save Directly writes demomap01.json in the repo (dev server only). New game,
          in the bar above, can start any named version. Named versions stay in this browser.
        </p>
      </section>
    </>
  );
}

function formatVersionTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function VersionLibrary({ editor }: { editor: MapEditor }) {
  const [name, setName] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState("");
  const trimmed = name.trim();
  return (
    <section className="panel editor-panel">
      <h2>Versions</h2>
      <form
        className="version-save"
        onSubmit={(e) => {
          e.preventDefault();
          const error = editor.saveVersion(name);
          if (error === "") {
            setName(trimmed);
          }
        }}
      >
        <input
          type="text"
          value={name}
          maxLength={VERSION_NAME_MAX}
          placeholder="Version name"
          aria-label="Version name"
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="primary" disabled={trimmed === ""}>
          Save version
        </button>
      </form>
      {editor.versions.length === 0 ? (
        <p className="muted editor-hint">No saved versions yet. The map you are editing still autosaves on its own.</p>
      ) : (
        <ul className="version-list">
          {editor.versions.map((version) => (
            <li key={version.id}>
              <span className="version-name" title={version.name}>
                {version.name}
              </span>
              <span className="muted version-when mono">
                {pendingDeleteId === version.id ? "The open map stays." : formatVersionTime(version.savedAt)}
              </span>
              <span className="version-actions">
                {pendingDeleteId === version.id ? (
                  <>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        editor.deleteVersion(version.id);
                        setPendingDeleteId("");
                        if (trimmed === version.name) {
                          setName("");
                        }
                      }}
                    >
                      Delete
                    </button>
                    <button type="button" onClick={() => setPendingDeleteId("")}>
                      Keep
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => editor.loadVersion(version.id)}>
                      Load
                    </button>
                    <button type="button" onClick={() => setPendingDeleteId(version.id)}>
                      Delete
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted editor-hint">
        Saved in this browser. Saving a name that already exists replaces that version. After a load, Undo brings back
        the map you had open.
      </p>
    </section>
  );
}
