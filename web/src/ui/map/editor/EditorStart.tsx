import { useState } from "react";
import { isDict } from "../../../engine/model/types";
import type { MapVersion } from "./mapVersions";
import { editorFromMapJson, type EditorMap } from "./editorModel";
import { projectMapJson } from "../map_space";
import demoMapUrl from "../../../../../demomap01.json?url";
import global1940Url from "../../../../../demomap_global_1940.json?url";

/** Land coasts in `web/public/assets`. Unit drawings are not maps. */
const LAND_SVGS = [
  { name: "world_global.svg", url: "assets/world_global.svg" },
  { name: "ne_110m_land_FINAL_02.svg", url: "assets/ne_110m_land_FINAL_02.svg" },
  { name: "ne_110m_land_FINAL.svg", url: "assets/ne_110m_land_FINAL.svg" },
  { name: "ne_110m_land_adjsut.svg", url: "assets/ne_110m_land_adjsut.svg" },
] as const;

/** Scenario maps that ship with the game. `demo` is the map the editor already has loaded. */
const GAME_SCENARIOS = [
  { name: "demomap01.json", url: demoMapUrl, demo: true },
  { name: "demomap_global_1940.json", url: global1940Url, demo: false },
] as const;

function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

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
  /** Install an SVG coast. Empty when it opened; otherwise the reason. */
  onWorld(svg: string): string;
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
  const [opening, setOpening] = useState("");

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

  const openSvgText = (name: string, text: string) => {
    if (!text.includes("<path")) {
      setOpening("");
      setError(`${name} has no coast to slice.`);
      return;
    }
    setOpening(name);
    // Let the label paint before the coast is built. A large SVG holds the page for a moment.
    requestAnimationFrame(() => {
      const problem = onWorld(text);
      setOpening("");
      if (problem !== "") {
        setError(problem);
      }
    });
  };

  const openSvgUrl = (name: string, url: string) => {
    setError("");
    setOpening(name);
    void fetch(url)
      .then(async (res) => {
        if (!res.ok) {
          setOpening("");
          setError(`${name} did not load.`);
          return;
        }
        openSvgText(name, await res.text());
      })
      .catch(() => {
        setOpening("");
        setError(`${name} did not load.`);
      });
  };

  const readSvg = (file: File | undefined) => {
    if (!file) {
      return;
    }
    setError("");
    void file.text().then(
      (text) => openSvgText(file.name, text),
      () => setError(`${file.name} could not be read.`),
    );
  };

  const openScenarioUrl = (name: string, url: string) => {
    setError("");
    setOpening(name);
    void fetch(url)
      .then(async (res) => {
        if (!res.ok) {
          setOpening("");
          setError(`${name} did not load.`);
          return;
        }
        const parsed: unknown = JSON.parse(await res.text());
        setOpening("");
        if (!isDict(parsed)) {
          setError(`${name} is not a map.`);
          return;
        }
        onMap(editorFromMapJson(projectMapJson(parsed)));
      })
      .catch(() => {
        setOpening("");
        setError(`${name} did not load.`);
      });
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
        {error !== "" && <p className="warn">{error}</p>}
        {opening !== "" && <p className="muted">Opening {opening}…</p>}
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
          <label className="editor-start-check" title="A blank ocean. You draw the coast. Uncheck this to keep the world landmass.">
            <input
              type="checkbox"
              checked={emptyOcean}
              aria-label="Empty ocean"
              onChange={(event) => setEmptyOcean(event.target.checked)}
            />
            Empty ocean
          </label>
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
          <h3>Load pre-existing map</h3>
          <p className="muted">Choose any .svg to load your map and begin slicing it into regions.</p>
          <ul className="editor-start-versions">
            {LAND_SVGS.map((file) => (
              <li key={file.name}>
                <button type="button" disabled={opening !== ""} onClick={() => openSvgUrl(file.name, assetUrl(file.url))}>
                  {file.name}
                </button>
              </li>
            ))}
          </ul>
          <label className="editor-start-file">
            Upload SVG
            <input
              type="file"
              accept=".svg,image/svg+xml"
              aria-label="Upload SVG"
              disabled={opening !== ""}
              onChange={(event) => {
                readSvg(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
        </section>
        <section>
          <h3>Load scenario</h3>
          <ul className="editor-start-versions">
            {GAME_SCENARIOS.map((file) => (
              <li key={file.name}>
                <button
                  type="button"
                  disabled={opening !== ""}
                  onClick={() => (file.demo ? onDemo() : openScenarioUrl(file.name, file.url))}
                >
                  {file.name}
                </button>
              </li>
            ))}
          </ul>
          <label className="editor-start-file">
            Upload JSON
            <input
              type="file"
              accept="application/json,.json"
              aria-label="Upload JSON"
              disabled={opening !== ""}
              onChange={(event) => {
                readMap(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          {versions.length > 0 && (
            <ul className="editor-start-versions">
              {versions.map((version) => (
                <li key={version.id}>
                  <button type="button" disabled={opening !== ""} onClick={() => onVersion(version.id)}>
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
