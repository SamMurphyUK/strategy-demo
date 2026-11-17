import { useState } from "react";
import { isDict } from "../../../engine/model/types";
import type { MapVersion } from "./mapVersions";
import { editorFromMapJson, type EditorMap } from "./editorModel";
import { projectMapJson } from "../map_space";

export function EditorStart({
  versions,
  onBlank,
  onDemo,
  onVersion,
  onMap,
  onBack,
}: {
  versions: MapVersion[];
  onBlank(width: number, height: number, referenceUrl: string | null): void;
  onDemo(): void;
  onVersion(id: string): void;
  onMap(map: EditorMap): void;
  onBack(): void;
}) {
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(504);
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
          Draw land with the pen, split it with the knife, and cut sea zones with the lattice. The lattice clips
          each zone to the coast. Calculate Neighbors writes land, sea, and coastal borders. The Link tool adds a
          strait or marks a border impassable.
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
          <button
            type="button"
            className="primary"
            onClick={() => onBlank(Math.max(64, width) || 800, Math.max(64, height) || 504, referenceUrl)}
          >
            Start blank map
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
