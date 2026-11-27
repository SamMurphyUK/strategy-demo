import { useState } from "react";
import { isDict } from "../../../engine/model/types";
import type { MapVersion } from "./mapVersions";
import { editorFromMapJson, type EditorMap } from "./editorModel";
import { projectMapJson } from "../map_space";

export function EditorStart({
  versions,
  onBlank,
  onWorld,
  onDemo,
  onVersion,
  onMap,
  onBack,
}: {
  versions: MapVersion[];
  onBlank(width: number, height: number, referenceUrl: string | null, emptyOcean: boolean): void;
  onWorld(svg: string): void;
  onDemo(): void;
  onVersion(id: string): void;
  onMap(map: EditorMap): void;
  onBack(): void;
}) {
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(504);
  const [emptyOcean, setEmptyOcean] = useState(true);
  const [referenceName, setReferenceName] = useState("");
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [error, setError] = useState("");

  const readReference = (file: File | undefined) => {
    if (!file) {
      setReferenceName("");
      setReferenceUrl(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setReferenceName(file.name);
      setReferenceUrl(typeof reader.result === "string" ? reader.result : null);
    };
    reader.readAsDataURL(file);
  };

  const openWorld = () => {
    setError("");
    const url = `${import.meta.env.BASE_URL}assets/world_global.svg`;
    void fetch(url)
      .then(async (res) => {
        if (!res.ok) {
          setError("The world map did not load.");
          return;
        }
        const text = await res.text();
        if (!text.includes("<path")) {
          setError("The world map did not load.");
          return;
        }
        onWorld(text);
      })
      .catch(() => setError("The world map did not load."));
  };

  const readMap = (file: File | undefined) => {
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed: unknown = JSON.parse(String(reader.result ?? ""));
        if (!isDict(parsed)) {
          setError("That file is not a map.");
          return;
        }
        onMap(editorFromMapJson(projectMapJson(parsed)));
      } catch {
        setError("That file is not map JSON.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="editor-start-scrim" role="dialog" aria-label="Start a map">
      <div className="editor-start">
        <h2>Map editor</h2>
        <p className="muted">
          Landmass draws the coast. Cut slices that coast into territories and sea zones. Open a saved landmass
          SVG from Cut to slice it. The lattice clips each zone to the coast.
        </p>
        {error !== "" && <p className="warn">{error}</p>}
        <section>
          <h3>Start blank map</h3>
          <div className="editor-start-size">
            <label>
              Width
              <input
                type="number"
                min={64}
                max={4000}
                value={width}
                aria-label="Map width"
                onChange={(event) => setWidth(Number(event.target.value))}
              />
            </label>
            <label>
              Height
              <input
                type="number"
                min={64}
                max={4000}
                value={height}
                aria-label="Map height"
                onChange={(event) => setHeight(Number(event.target.value))}
              />
            </label>
          </div>
          <label className="editor-start-file">
            Reference image
            <input
              type="file"
              accept="image/*"
              aria-label="Reference image"
              onChange={(event) => readReference(event.target.files?.[0])}
            />
          </label>
          {referenceName !== "" && <p className="muted">Tracing sheet: {referenceName}</p>}
          <label className="editor-start-check">
            <input
              type="checkbox"
              checked={emptyOcean}
              aria-label="Empty ocean"
              onChange={(event) => setEmptyOcean(event.target.checked)}
            />
            Empty ocean
          </label>
          <p className="muted">
            {emptyOcean
              ? "No continents. Draw the coast, then switch to Cut."
              : "The world landmass stays on the board."}
          </p>
          <button
            type="button"
            className="primary"
            onClick={() =>
              onBlank(Math.max(64, width) || 800, Math.max(64, height) || 504, referenceUrl, emptyOcean)
            }
          >
            Start blank map
          </button>
        </section>
        <section>
          <h3>World map</h3>
          <p className="muted">Global coast. Suez and Panama are open. Opening it builds the land and sea blocks, which takes a moment.</p>
          <button type="button" className="primary" onClick={openWorld}>
            Slice world map
          </button>
        </section>
        <section>
          <h3>Load existing map</h3>
          <div className="editor-start-actions">
            <button type="button" onClick={onDemo}>
              Demo map
            </button>
            <label className="editor-start-file">
              Import JSON
              <input
                type="file"
                accept="application/json,.json"
                aria-label="Import map JSON"
                onChange={(event) => readMap(event.target.files?.[0])}
              />
            </label>
          </div>
          {versions.length > 0 && (
            <ul className="editor-start-versions">
              {versions.map((version) => (
                <li key={version.id}>
                  <button type="button" onClick={() => onVersion(version.id)}>
                    {version.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <button type="button" onClick={onBack}>
          Back to menu
        </button>
      </div>
    </div>
  );
}
