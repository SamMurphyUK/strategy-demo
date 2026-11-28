import { BOARD_SKINS, skinDisables, skinFor, skinOwner } from "../viewport3d/skins/boardSkin";
import { toggleInspector } from "./unitTransformUi";
import { getIslandRevision, getIslandScales, setIslandScale, subscribeIslandScales } from "./islandOverrides";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { FactionKey } from "../theme/factionPalette";
import {
  borderPasses,
  currentTune,
  groundRatio,
  groundSquash,
  landColor,
  pitchDegrees,
  unitTipDegrees,
  vanillaTune,
  type BoardTune,
  type Knob,
} from "./boardTune";
import { getBoardTune, resetBoardTune, setBoardTune, subscribeBoardTune } from "./boardTuneStore";
import {
  applyVisuals,
  EFFECT_WEIGHTS,
  getVisualRev,
  mapVisuals,
  OUTLINE_MODES,
  resetVisuals,
  setVisual,
  subscribeVisuals,
  SUN_CYCLES,
  VISUAL_PRESETS,
  VISUAL_RANGES,
  visualPresetJson,
  visualPresetOf,
  type EffectWeight,
  type FrontlineStyle,
  type FriendlyBorderStyle,
  type HighlightRule,
  type MapVisualConfig,
  type OutlineMode,
  type SunCycle,
  type VisualKey,
  type VisualPresetName,
} from "./mapVisualConfig";
import { getDrawSample, subscribeDrawSample } from "./renderDebug";

const FACTIONS: readonly { key: FactionKey; label: string }[] = [
  { key: "US", label: "United States" },
  { key: "UK", label: "United Kingdom" },
  { key: "GER", label: "Germany" },
  { key: "JAP", label: "Japan" },
  { key: "USSR", label: "Soviet Union" },
  { key: "NEUTRAL", label: "Neutral" },
];

function num(value: number): string {
  if (!Number.isFinite(value)) {
    return "";
  }
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function Slider(props: {
  label: string;
  title?: string;
  min: number;
  max: number;
  value: number;
  disabled?: boolean;
  display?: string;
  onChange(value: number): void;
}) {
  return (
    <label className="coast-slider" title={props.title}>
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step="any"
        value={Number.isFinite(props.value) ? props.value : props.min}
        disabled={props.disabled}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
      <span className="mono">{props.display ?? num(props.value)}</span>
    </label>
  );
}

function Fold(props: { title: string; startOpen?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (props.startOpen && ref.current) {
      ref.current.open = true;
    }
  }, []);
  return (
    <details className="tune-fold" ref={ref}>
      <summary>{props.title}</summary>
      {props.children}
    </details>
  );
}

const WEIGHT_LABEL: Record<EffectWeight, string> = { off: "Off", low: "Low", medium: "Medium", high: "High" };
const OUTLINE_LABEL: Record<OutlineMode, string> = {
  "units-only": "Line",
  "watercolor-only": "Wash",
  both: "Line and wash",
  off: "Off",
};
const SUN_LABEL: Record<SunCycle, string> = {
  animated: "Moving",
  "static-noon": "Noon",
  "static-golden": "Golden hour",
  off: "Off",
};

/** One of a fixed set of choices, on the same row grid as the sliders. */
function Choice<T extends string>(props: {
  label: string;
  title: string;
  value: T;
  options: readonly T[];
  names: Record<T, string>;
  onChange(value: T): void;
}) {
  return (
    <label className="coast-slider" title={props.title}>
      <span>{props.label}</span>
      <select aria-label={props.title} value={props.value} onChange={(event) => props.onChange(event.target.value as T)}>
        {props.options.map((option) => (
          <option key={option} value={option}>
            {props.names[option]}
          </option>
        ))}
      </select>
      <span />
    </label>
  );
}

function KnobRow(props: { label: string; title: string; knob: Knob; onChange(knob: Knob): void }) {
  return (
    <label className="coast-slider tune-knob" title={props.title}>
      <span>
        <input
          type="checkbox"
          checked={props.knob.on}
          onChange={(event) => props.onChange({ ...props.knob, on: event.target.checked })}
        />
        {props.label}
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step="any"
        value={props.knob.amount}
        disabled={!props.knob.on}
        onChange={(event) => props.onChange({ ...props.knob, on: true, amount: Number(event.target.value) })}
      />
      <span className="mono">{props.knob.on ? num(props.knob.amount) : "off"}</span>
    </label>
  );
}

type NumberKey = { [K in VisualKey]: MapVisualConfig[K] extends number ? K : never }[VisualKey];
type SwitchKey = { [K in VisualKey]: MapVisualConfig[K] extends boolean ? K : never }[VisualKey];

/** A switch for one feature of the table. */
function Flag(props: { name: SwitchKey; label: string; title?: string }) {
  const foreign = skinDisables(skinFor(mapVisuals, true), props.name);
  return (
    <label className="art-tune-flag" title={foreign ? skinNote(props.title, props.name) : props.title} style={foreign ? SKIN_DIM : undefined}>
      <input
        type="checkbox"
        aria-label={props.title ?? props.label}
        checked={mapVisuals[props.name]}
        disabled={foreign}
        onChange={(event) => setVisual(props.name, event.target.checked)}
      />
      {props.label}
    </label>
  );
}

/** How a setting that belongs to the other skin looks: dimmed, and locked. */
const SKIN_DIM = { opacity: 0.45 } as const;

/** The tip for a dimmed setting: what it is, and which skin it belongs to. */
function skinNote(title: string | undefined, key: VisualKey): string {
  const owner = skinOwner(key);
  return `${title ?? ""} (${owner ? BOARD_SKINS[owner].label : "another skin"} only)`.trim();
}

/** One territory on an island, lowered on its own: its id, a scale, and a way to clear it. The rest of the islands take the global scale. */
function IslandRegionHeight() {
  useSyncExternalStore(subscribeIslandScales, getIslandRevision, getIslandRevision);
  const [id, setId] = useState("");
  const scales = getIslandScales();
  const own = id !== "" ? scales[id] : undefined;
  return (
    <div className="coast-slider" title="Lower one island's territory on its own. Type the territory's id as the map names it; clear it to use the island height above.">
      <span>Island, by territory</span>
      <input type="text" className="mono" placeholder="territory id" value={id} onChange={(event) => setId(event.target.value.trim())} list="island-regions" />
      <input type="range" min={0.15} max={1} step="any" value={own ?? mapVisuals.islandElevationScale} disabled={id === ""} aria-label="Height of this territory's island" onChange={(event) => setIslandScale(id, Number(event.target.value))} />
      <button type="button" disabled={own === undefined} onClick={() => setIslandScale(id, null)}>
        Clear
      </button>
      <span className="muted">{Object.keys(scales).length > 0 ? `${Object.keys(scales).length} set: ${Object.keys(scales).join(", ")}` : "none set"}</span>
    </div>
  );
}

/** A slider and a number box for one setting. Both hold the same value, inside the setting's range. */
function Num(props: { name: NumberKey; label: string; title: string; unit?: string; off?: boolean }) {
  const [min, max] = VISUAL_RANGES[props.name] ?? [0, 1];
  const value = mapVisuals[props.name];
  // A setting that belongs to another skin does nothing under this one, so it is dimmed and locked.
  const foreign = skinDisables(skinFor(mapVisuals, true), props.name);
  const off = props.off || foreign;
  return (
    <label className="coast-slider" title={foreign ? skinNote(props.title, props.name) : props.title} style={foreign ? SKIN_DIM : undefined}>
      <span>{props.label}</span>
      <input
        type="range"
        aria-label={props.title}
        min={min}
        max={max}
        step="any"
        value={value}
        disabled={off}
        onChange={(event) => setVisual(props.name, Number(event.target.value))}
      />
      <input
        type="number"
        className="mono tune-number"
        aria-label={`${props.title}, as a number`}
        min={min}
        max={max}
        step={(max - min) / 100}
        value={Number(value.toFixed(3))}
        disabled={off}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (event.target.value !== "" && Number.isFinite(next)) {
            setVisual(props.name, next);
          }
        }}
      />
    </label>
  );
}

/**
 * Copies text the old way, through a selection. For when the clipboard is refused: a page that
 * is not focused, or one not served over https.
 */
function copyBySelection(text: string): boolean {
  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  box.style.position = "fixed";
  box.style.opacity = "0";
  document.body.appendChild(box);
  box.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  box.remove();
  return ok;
}

/**
 * Copies the live settings as a preset, and says so for a moment. If the browser refuses both
 * ways of copying, the text is put in a box to copy by hand.
 */
function CopyPreset() {
  const [copied, setCopied] = useState<"" | "yes" | "no">("");
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (copied === "") {
      return;
    }
    const timer = window.setTimeout(() => setCopied(""), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const settle = (text: string, ok: boolean) => {
    setCopied(ok ? "yes" : "no");
    setShown(ok ? null : text);
  };
  return (
    <>
      <button
        type="button"
        onClick={() => {
          const text = visualPresetJson(mapVisuals);
          const done = navigator.clipboard?.writeText(text);
          if (!done) {
            settle(text, copyBySelection(text));
            return;
          }
          done.then(
            () => settle(text, true),
            () => settle(text, copyBySelection(text)),
          );
        }}
      >
        {copied === "yes" ? "Copied" : copied === "no" ? "Copy failed" : "Copy Preset JSON"}
      </button>
      {shown !== null && (
        <textarea className="tune-preset" aria-label="Preset JSON" readOnly rows={6} value={shown} onFocus={(event) => event.currentTarget.select()} />
      )}
    </>
  );
}

/** Picture controls for the campaign board. Z opens the panel that holds this. */

/**
 * Hides every setting that does not match `query`, and every heading, note, and fold with nothing
 * left under it, and opens the folds that still show something. A match is in the setting's name or
 * its tip. With an empty query everything is shown again, and the folds go back as they were.
 */
function filterSettings(root: HTMLElement, query: string): void {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const folds = Array.from(root.querySelectorAll<HTMLDetailsElement>("details.tune-fold"));
  for (const fold of folds) {
    const open = fold.dataset.wasOpen;
    if (words.length === 0) {
      fold.style.display = "";
      if (open !== undefined) {
        fold.open = open === "1";
        delete fold.dataset.wasOpen;
      }
      for (const child of Array.from(fold.children)) {
        if (child.tagName !== "SUMMARY") {
          (child as HTMLElement).style.display = "";
        }
      }
      continue;
    }
    if (open === undefined) {
      fold.dataset.wasOpen = fold.open ? "1" : "0";
    }
    let any = false;
    let heading: HTMLElement | null = null;
    let headingHasMatch = false;
    const closeGroup = () => {
      if (heading) {
        heading.style.display = headingHasMatch ? "" : "none";
      }
    };
    for (const child of Array.from(fold.children) as HTMLElement[]) {
      if (child.tagName === "SUMMARY") {
        continue;
      }
      if (child.tagName === "H3") {
        closeGroup();
        heading = child;
        headingHasMatch = false;
        continue;
      }
      if (child.tagName === "LABEL") {
        const text = `${child.textContent ?? ""} ${child.getAttribute("title") ?? ""} ${child.querySelector("input")?.getAttribute("aria-label") ?? ""}`.toLowerCase();
        const match = words.every((word) => text.includes(word));
        child.style.display = match ? "" : "none";
        if (match) {
          any = true;
          headingHasMatch = true;
        }
      } else {
        // A note, or a row of buttons: out of the way while searching.
        child.style.display = "none";
      }
    }
    closeGroup();
    fold.style.display = any ? "" : "none";
    if (any) {
      fold.open = true;
    }
  }
}

export function BoardLookPanel() {
  const tune = useSyncExternalStore(subscribeBoardTune, getBoardTune, getBoardTune);
  useSyncExternalStore(subscribeVisuals, getVisualRev, getVisualRev);
  const sample = useSyncExternalStore(subscribeDrawSample, getDrawSample, getDrawSample);
  const zoom = sample.zoom > 0 ? sample.zoom : tune.tilt.end;
  const squash = groundSquash(zoom, tune.tilt);
  const pitch = pitchDegrees(groundRatio(zoom, tune.tilt));
  const tip = unitTipDegrees(zoom, tune);

  const edit = (patch: Partial<BoardTune>) => {
    setBoardTune({ ...tune, ...patch, look: "custom" });
  };

  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLElement>(null);
  const rev = useSyncExternalStore(subscribeVisuals, getVisualRev, getVisualRev);
  useEffect(() => {
    if (rootRef.current) {
      filterSettings(rootRef.current, query);
    }
  }, [query, rev]);

  return (
    <section aria-label="Board look" ref={rootRef}>
      <h2>Board</h2>
      <button type="button" onClick={toggleInspector} title="Open the unit transform inspector, to move the figures on their bases. The T key does the same." aria-label="Transform (T)">
        Transform (T)
      </button>
      <input
        type="search"
        className="tune-search"
        placeholder="Search settings"
        aria-label="Search the board look settings"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        style={{ width: "100%", boxSizing: "border-box", margin: "4px 0 8px" }}
      />
      <Fold title="Camera" startOpen>
        <p className="muted">
          The ground holds the zoomed-out squash until the start zoom, then shortens in a straight line to the zoomed-in squash. 0 is flat. 15 is the shipped tip.
        </p>
        <Slider
          label="Out"
          title="Vertical squash while zoomed out, in percent"
          min={0}
          max={35}
          value={tune.tilt.far * 100}
          display={`${Math.round(tune.tilt.far * 100)}%`}
          onChange={(value) => edit({ tilt: { ...tune.tilt, far: value / 100 } })}
        />
        <Slider
          label="In"
          title="Vertical squash while zoomed in, in percent"
          min={0}
          max={35}
          value={tune.tilt.near * 100}
          display={`${Math.round(tune.tilt.near * 100)}%`}
          onChange={(value) => edit({ tilt: { ...tune.tilt, near: value / 100 } })}
        />
        <Slider
          label="Start"
          title="Zoom where the squash starts to change"
          min={0.4}
          max={6}
          value={tune.tilt.start}
          onChange={(value) => edit({ tilt: { ...tune.tilt, start: value } })}
        />
        <Slider
          label="End"
          title="Zoom where the squash finishes changing"
          min={0.8}
          max={12}
          value={tune.tilt.end}
          onChange={(value) => edit({ tilt: { ...tune.tilt, end: value } })}
        />
        <p className="muted">
          This zoom is {pitch.toFixed(1)}° from overhead, {Math.round(squash * 100)}% short.
        </p>
      </Fold>
      <Fold title="Figures">
        <p className="muted">
          The figure tips from the zoomed-out angle to the zoomed-in angle. 0 faces the screen. The camera at this zoom is {pitch.toFixed(1)}° from overhead.
        </p>
        <Slider
          label="Out"
          title="Degrees the figure tips while zoomed out"
          min={0}
          max={60}
          value={tune.unit.far}
          display={`${Math.round(tune.unit.far)}°`}
          onChange={(value) => edit({ unit: { ...tune.unit, far: value } })}
        />
        <Slider
          label="In"
          title="Degrees the figure tips while zoomed in"
          min={0}
          max={60}
          value={tune.unit.near}
          display={`${Math.round(tune.unit.near)}°`}
          onChange={(value) => edit({ unit: { ...tune.unit, near: value } })}
        />
        <Slider
          label="Start"
          title="Zoom where the figure angle starts to change"
          min={0.4}
          max={6}
          value={tune.unit.start}
          onChange={(value) => edit({ unit: { ...tune.unit, start: value } })}
        />
        <Slider
          label="End"
          title="Zoom where the figure angle finishes changing"
          min={0.8}
          max={12}
          value={tune.unit.end}
          onChange={(value) => edit({ unit: { ...tune.unit, end: value } })}
        />
        <p className="muted">This zoom tips the figure {tip.toFixed(1)}°.</p>
      </Fold>
      <Fold title="Look">
        <label className="coast-slider">
          <span>Set</span>
          <select
            aria-label="Board set"
            value={tune.look}
            onChange={(event) => {
              const name = event.target.value;
              if (name === "current") {
                setBoardTune(currentTune());
              } else if (name === "vanilla") {
                setBoardTune(vanillaTune());
              }
            }}
          >
            <option value="current">Current</option>
            <option value="vanilla">Vanilla</option>
            {tune.look === "custom" ? <option value="custom">Custom</option> : null}
          </select>
          <span />
        </label>
        <p className="muted">
          Vanilla is the plain desaturated board: no terrain dressing, no lens, the previous land colours and borders.
        </p>
        <button type="button" onClick={() => resetBoardTune()}>
          Reset board
        </button>
      </Fold>
      <Fold title="Effects">
        <KnobRow label="Relief" title="Sun shading and cast shadows" knob={tune.relief} onChange={(relief) => edit({ relief })} />
        <KnobRow label="Water" title="Swell and surf" knob={tune.water} onChange={(water) => edit({ water })} />
        <KnobRow label="Smoke" title="Battle smoke and chimneys" knob={tune.smoke} onChange={(smoke) => edit({ smoke })} />
        <KnobRow label="Vignette" title="Darkened corners" knob={tune.vignette} onChange={(vignette) => edit({ vignette })} />
        <KnobRow label="Focus" title="Soft top and bottom of the close view" knob={tune.focus} onChange={(focus) => edit({ focus })} />
        <label className="coast-slider tune-knob" title="On, saturation eases down as you zoom in">
          <span>
            <input type="checkbox" checked={tune.gradeZoom} onChange={(event) => edit({ gradeZoom: event.target.checked })} />
            Grade
          </span>
          <input
            type="range"
            min={0.4}
            max={1}
            step="any"
            value={tune.saturation}
            disabled={tune.gradeZoom}
            onChange={(event) => edit({ gradeZoom: false, saturation: Number(event.target.value) })}
          />
          <span className="mono">{tune.gradeZoom ? "zoom" : num(tune.saturation)}</span>
        </label>
        <label className="coast-slider tune-knob" title="On, the close view warms. Off, the slider is a fixed warm grade">
          <span>
            <input type="checkbox" checked={tune.warmZoom} onChange={(event) => edit({ warmZoom: event.target.checked })} />
            Warm
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step="any"
            value={tune.warm}
            disabled={tune.warmZoom}
            onChange={(event) => edit({ warmZoom: false, warm: Number(event.target.value) })}
          />
          <span className="mono">{tune.warmZoom ? "zoom" : num(tune.warm)}</span>
        </label>
      </Fold>
      <Fold title="Terrain">
        <p className="muted">Trees, mountains and buildings stay off until the close zoom. 0 is the fitted map. 1 is the closest zoom.</p>
        <KnobRow label="Show" title="Turn the terrain off, or scale how strongly it grows in" knob={tune.props} onChange={(props) => edit({ props })} />
        <Slider
          label="From"
          title="Closeness where terrain starts"
          min={0}
          max={1}
          value={tune.terrainFrom}
          onChange={(terrainFrom) => edit({ terrainFrom })}
        />
        <Slider
          label="To"
          title="Closeness where terrain is full"
          min={0}
          max={1}
          value={tune.terrainTo}
          onChange={(terrainTo) => edit({ terrainTo })}
        />
      </Fold>
      <Fold title="Faction colours">
        <label className="coast-slider">
          <span>Set</span>
          <select
            aria-label="Faction colour set"
            value={tune.palette}
            onChange={(event) => edit({ palette: event.target.value as BoardTune["palette"], colors: {} })}
          >
            <option value="strip">Strip</option>
            <option value="parchment">Parchment</option>
          </select>
          <span />
        </label>
        <p className="muted">Strip is the current map. Parchment is the previous tint. A picked colour overrides that faction.</p>
        {FACTIONS.map((faction) => (
          <label key={faction.key} className="tune-color">
            <span>{faction.label}</span>
            <input
              type="color"
              aria-label={`${faction.label} land`}
              value={landColor(faction.key, tune).toLowerCase()}
              onChange={(event) => edit({ colors: { ...tune.colors, [faction.key]: event.target.value } })}
            />
          </label>
        ))}
      </Fold>
      <Fold title="Borders">
        <label className="coast-slider">
          <span>Line</span>
          <select
            aria-label="Territory border"
            value={tune.borders}
            onChange={(event) => edit({ borders: event.target.value as BoardTune["borders"] })}
          >
            <option value="current">Charcoal</option>
            <option value="previous">Sepia</option>
          </select>
          <span className="tune-border" style={{ background: borderPasses(tune)[1]?.color ?? "#4B3D44" }} />
        </label>
        <p className="muted">Charcoal is the current territory line. Sepia is the previous one. On Shogun V2, sepia recolours the ink.</p>
        <label className="art-tune-flag">
          <input
            type="checkbox"
            checked={tune.territoryLines}
            onChange={(event) => edit({ territoryLines: event.target.checked })}
          />
          Territory lines
        </label>
        <label className="art-tune-flag">
          <input type="checkbox" checked={tune.enemyBand} onChange={(event) => edit({ enemyBand: event.target.checked })} />
          Enemy band
        </label>
        <p className="muted">The lines are the old border between territories. The band is the old wide mark where two factions meet.</p>
      </Fold>
      <Fold title="Light and lens" startOpen>
        <p className="muted">
          The 3D board only. Off means the pass is not drawn at all. The shade, the shadows, and the sea's sheen grow in with the close zoom, like the relief.
        </p>
        <Choice
          label="Sun"
          title="Sun"
          value={mapVisuals.sunCycle}
          options={SUN_CYCLES}
          names={SUN_LABEL}
          onChange={(value) => setVisual("sunCycle", value)}
        />
        <Choice
          label="Shadows"
          title="Cast shadows"
          value={mapVisuals.shadowQuality}
          options={EFFECT_WEIGHTS}
          names={WEIGHT_LABEL}
          onChange={(value) => setVisual("shadowQuality", value)}
        />
        <Choice
          label="Shade"
          title="Contact shade"
          value={mapVisuals.aoWeight}
          options={EFFECT_WEIGHTS}
          names={WEIGHT_LABEL}
          onChange={(value) => setVisual("aoWeight", value)}
        />
        <Choice
          label="Sky"
          title="Sky on the sea"
          value={mapVisuals.envReflectionWeight}
          options={EFFECT_WEIGHTS}
          names={WEIGHT_LABEL}
          onChange={(value) => setVisual("envReflectionWeight", value)}
        />
        <Choice
          label="Glow"
          title="Glow"
          value={mapVisuals.bloomWeight}
          options={EFFECT_WEIGHTS}
          names={WEIGHT_LABEL}
          onChange={(value) => setVisual("bloomWeight", value)}
        />
        <Choice
          label="Grain"
          title="Paper grain"
          value={mapVisuals.filmGrainWeight}
          options={EFFECT_WEIGHTS}
          names={WEIGHT_LABEL}
          onChange={(value) => setVisual("filmGrainWeight", value)}
        />
        <Choice
          label="Outline"
          title="Marked stack outline"
          value={mapVisuals.outlineMode}
          options={OUTLINE_MODES}
          names={OUTLINE_LABEL}
          onChange={(value) => setVisual("outlineMode", value)}
        />
        <p className="muted">
          Shadows fall from the cliffs, the terrain, and the figures. The glow spreads from embers and the sun on the sea. The outline marks the stack you picked or point at, as a line, a watercolour wash, or both, and never a territory.
        </p>
      </Fold>
      <Fold title="Table" startOpen>
        <p className="muted">
          The 3D board only. Each part has a switch and its own numbers. A part that is off is not built, not drawn, and not in any shader. The ranges, the grain, and the roads come in with the close zoom.
        </p>
        <div className="tune-actions">
          <CopyPreset />
          <button type="button" onClick={() => resetVisuals()}>
            Reset Defaults
          </button>
        </div>

        <h3>Pixel chart</h3>
        <p className="muted">
          The land and the sea as square texels fixed to the board. On, it takes the place of the printed colours, the grain, and the painted rivers and roads, and draws its own. The wash sliders under Shogun set how much faction colour lies over it.
        </p>
        <Flag name="enableFauxPixelMap" label="Pixel chart" title="The land and the sea as a chart of square texels fixed to the board" />
        <Num name="pixelTexelDensity" label="Texels" title="Texels to a world unit at the closest zoom. The grid coarsens by halves as the camera rises." off={!mapVisuals.enableFauxPixelMap} />
        <Num name="pixelHillshadeContrast" label="Hillshade" title="How hard a slope is lit or shaded. 0 is a flat chart." off={!mapVisuals.enableFauxPixelMap} />
        <Num name="pixelShadowSteps" label="Tones" title="Flat tones of shade, and of light, either side of level ground. A whole number." off={!mapVisuals.enableFauxPixelMap} />
        <Num name="pixelDitherStrength" label="Dither" title="How far the 4 by 4 ordered dither mixes two neighbouring tones. 0 is hard bands." off={!mapVisuals.enableFauxPixelMap} />
        <Num name="pixelPaletteSaturation" label="Saturation" title="Saturation of the chart's land palette. 1 is the palette as listed." off={!mapVisuals.enableFauxPixelMap} />
        <Num name="seaContourSteps" label="Sea bands" title="Depth bands on the sea, from the shelf to the open ocean. A whole number." off={!mapVisuals.enableFauxPixelMap} />
        <Num name="coastRimIntensity" label="Coast rim" title="Strength of the one-texel ochre rim where the land meets the sea" off={!mapVisuals.enableFauxPixelMap} />
        <Flag name="enablePixelFoam" label="Shallows foam" title="The pale dithered shallows along the coast. Off, the sea stays its deep colour to the shore." />
        <Num name="pixelFoamReach" label="Foam reach" title="How much of the shelf stays pale. 1 is the whole shelf; 0.7 takes it in by 30%." off={!mapVisuals.enableFauxPixelMap || !mapVisuals.enablePixelFoam} />
        <Num name="pixelFoamBleed" label="Foam bleed" title="How far the edge of the shallows breathes in and out. 0 is a fixed edge." off={!mapVisuals.enableFauxPixelMap || !mapVisuals.enablePixelFoam} />
        <Flag name="regionalPaletteDetail" label="Climate palettes" title="Each territory takes the palette of its climate: temperate, boreal, arid, or tropical. Off, the whole land is one temperate ramp." />

        <h3>Waves</h3>
        <p className="muted">The rings of surf, the invisible wave front that sweeps the board and rocks the ships (it draws nothing), and the ships' own heave. The loop and the rocking are the two to tune.</p>
        <Num name="seaWaveRings" label="Wave rings" title="The rings of surf that roll in around the coast. 0 is none." />
        <Num name="seaSheenPops" label="Wave pops" title="How often a breaking wave throws a glint where the sun could catch it. 0 is never." />
        <Num name="waveLoopSeconds" label="Wave loop" title="Seconds for the invisible wave front to sweep the board and come round again." unit="s" />
        <Num name="waveDirectionDeg" label="Wave direction" title="The direction the front travels, in degrees: 0 runs west to east, 90 north to south." unit="deg" />
        <Num name="waterSwellAmp" label="Ocean swell" title="How high the sea heaves: the ambient swell, with the 20-second front standing taller. It lifts and drops the ships and climbs the cliffs. 0 is a flat sea." />
        <Num name="cliffSurgeFoam" label="Cliff surge foam" title="How much foam the swell leaves up a cliff wall as its crest climbs it. 0 is none." />
        <Num name="microMistWeight" label="Valley and jungle mist" title="How thick the mist lies between tall ridges and over the jungle, faded in with the close zoom. 0 is clear air." />
        <Num name="navalWaveRockAmp" label="Wave rock" title="How hard a wave front rocks a ship, in roll and pitch, as it crosses it. 0 is no rocking." />
        <Num name="subRockFactor" label="Sub rock" title="A submarine's share of a surface ship's rocking. 0.8 is 20% less." />
        <Num name="navalIdleBobAmp" label="Ship heave" title="How far a ship heaves up and down all the time. 0 holds it still. Pitch and roll between waves are all but level." />
        <Num name="navalSubmergeDepth" label="Ship depth" title="How far a ship's hull sits below the water, in world units. 0 floats on the surface." />

        <h3>Sea shine</h3>
        <Num name="seaSheenStrength" label="Sea shine" title="Brightness of the sun glitter on the sea. 0 is none." />
        <Num name="seaFarVisibility" label="Far shine" title="How much of the waves and the glitter is left with the camera zoomed all the way out. 0 is none, 1 is all of it." />
        <Num name="seaSheenRadius" label="Shine radius" title="Size of the patch of sea the sun glitter gathers in. 1 is the old size; 0.7 is 30% smaller." />
        <Num name="seaSheenFarRadius" label="Far radius" title="The shine radius as a share of itself with the camera zoomed all the way out. 0.9 is a further 10% smaller." />
        <Num name="seaSheenSpacing" label="Shine spacing" title="Distance between glints. 1 is the old spacing; 1.2 is 20% wider. It widens more as the camera rises." />
        <Num name="seaSheenFrequency" label="Shine frequency" title="How often the sea glints: how many are lit at once, and how fast each one flickers. 1 is the usual, 2 twice as many and twice as quick, 0 none." />
        <Num name="seaSheenScatter" label="Shine scatter" title="How far the glints and the edge of the patch are scattered off a regular grid." />

        <h3>Land height</h3>
        <Num name="terrainHeightScale" label="Land height" title="How high the land stands above the sea: the ceiling of the land and the height of its cliffs. 1 is as shipped." />

        <h3>Detailed sprites</h3>
        <Num name="detailedSpriteBaseScale" label="Sprite size" title="Size of the detailed unit sprites and their bases at the 3.8 reveal, as a share of the round token they replace." />
        <Num name="detailedSpriteWorldLock" label="Sprite world lock" title="How far the detailed sprites follow the board as the camera comes in. 1 is steady in world space, like the terrain and landmarks; 0 holds their size on screen." />

        <h3>Soft land</h3>
        <Flag name="enableSoftLand" label="Soft land" title="Close in, where the detailed figures stand, the land eases from the pixel chart to a soft posterized wash." />
        <Num name="dioramaPbrBlend" label="Diorama surface" title="How far the tiled grass, sand, snow and slate surface comes in over the pixel chart from zoom 3.8 to 4.3. 0 keeps the chart." />
        <Num name="dioramaTileScale" label="Diorama tile scale" title="The repeats of the diorama surface against the shipped size." />
        <Num name="microPitchDeg" label="Micro camera angle" title="Degrees above the horizon the camera looks from at the closest zoom. Lower is a more dramatic diorama angle." unit="deg" />
        <Num name="microSpriteTiltDeg" label="Micro figure lean" title="How far the 2D figures lean back more in the micro tier, so they stand against the horizon." unit="deg" />
        <Num name="seaJungleMistStrength" label="Jungle monsoon mist" title="The thick humid mist over the Southeast Asian jungles, hugging just above the canopy. 0 is none." />
        <Num name="microBirdsWeight" label="Birds" title="How many birds wheel over the close-up board. 0 is none." />
        <Num name="canopyBiomeContrast" label="Theater contrast" title="How far apart the theaters look: emerald and lime Pacific jungle against dry olive and acacia-gold Africa. 0 is one look." />
        <Num name="sandGlintStrength" label="Sand glitter" title="The glitter of quartz grains in the desert sand, close in. 0 is none." />
        <Num name="sandSubsurfaceAmber" label="Sand amber bounce" title="The warm terracotta-amber bounce in the shade of the dunes, so sand never goes muddy." />
        <Num name="snowDriftBleed" label="Snow drift bleed" title="How far the snow feathers into the flat land beside it, and bares the earth at its fringe. 0 is the chart's hard edge." />
        <Num name="crestPowderStrength" label="Crest powder" title="Sand and snow powder blown off the crests and ridges, close in. 0 is none." />
        <Num name="islandElevationScale" label="Island height" title="How much of its cliff an island keeps. 1 stands as tall as the continents; lower sits lower in the sea, so the Pacific atolls are not pillars." />
        <IslandRegionHeight />
        <Num name="cliffShadowStrength" label="Cliff shadow" title="How dark the cliffs are in their own shade: the foot where the water meets the wall, and the face turned from the sun. 0 is the old flat light." />
        <Num name="landmarkWashStrength" label="Monument wash" title="A deeper, hue-shifted wash pooled in the crevices, colonnades, arches and under the eaves of the city landmarks. 0 is none." />
        <Num name="landmarkDrybrushStrength" label="Monument drybrush" title="A crisp edge highlight on the ridges, domes and spires of the city landmarks, held under the bloom. 0 is none." />
        <Num name="landmarkGroundAO" label="Monument foot shade" title="The dark earth and stone contact shade across the foot of each landmark, so it sits rooted in the ground. 0 is none." />
        <Num name="shipSizeScale" label="Ship size" title="The size of the ships against what they were. 0.4 is 60% smaller." />
        <Num name="landmarkShadowStrength" label="Monument shadow" title="How deep the shadows drawn on the monuments go. 1 is the plain shade." />
        <Num name="tiltShiftStrength" label="Tilt-shift" title="The soft blur of the top and bottom of the frame in the micro tier. 0 is none." />
        <Num name="microMinDistance" label="Nearest camera" title="The nearest the camera may come, in camera distance. The tiers are 14, 7.5 and 3.8; micro ends here." />
        <Num name="dioramaNormalStrength" label="Diorama relief" title="How deep the diorama surface's relief reads in the light." />
        <Num name="albedoDetailStrength" label="Palette detail" title="How much of the photographed sets' luminance modulates the palette colour. 0 is the chart's flat colour." />
        <Num name="terrainHillRelief" label="Rolling hills" title="The height of the broad rolling hills, dune ridges and basins, as a share of the mountains' height. 0 is flat." />
        <Num name="forestUnderstoryTint" label="Woods ground tint" title="How far the ground darkens and enriches under dense trees." />
        <Num name="desertHeatHaze" label="Desert haze" title="The warm amber haze over the desert, close in." />
        <Num name="snowColdTint" label="Snow cold tint" title="The cool slate-blue overcast over the snow, and the cold in its shade." />
        <Num name="windStrength" label="Wind" title="How strongly the wind drives the snow flurries." />
        <Num name="softLandFrom" label="Soft from" title="The zoom where the land starts to soften. The sprites arrive at 3.8." off={!mapVisuals.enableFauxPixelMap || !mapVisuals.enableSoftLand} />
        <Num name="softLandTo" label="Soft to" title="The zoom where the land is fully soft." off={!mapVisuals.enableFauxPixelMap || !mapVisuals.enableSoftLand} />
        <Num name="softLandDither" label="Soft dither" title="Dither left on the soft land. 0 is none, 1 is as the strategic chart." off={!mapVisuals.enableFauxPixelMap || !mapVisuals.enableSoftLand} />
        <Num name="softLandSaturation" label="Soft colour" title="Colour left on the soft land. 1 is as the strategic chart." off={!mapVisuals.enableFauxPixelMap || !mapVisuals.enableSoftLand} />
        <Num name="softLandValueBand" label="Soft light" title="Light and shade left on the soft land. 1 is as the strategic chart." off={!mapVisuals.enableFauxPixelMap || !mapVisuals.enableSoftLand} />
        <Num name="softLandBrush" label="Brush" title="How far brush strokes wander the soft bands. 0 is clean bands." off={!mapVisuals.enableFauxPixelMap || !mapVisuals.enableSoftLand} />

        <h3>Landmarks</h3>
        <Num name="landmarkRimStrength" label="Landmark shine" title="How hard the sun catches a landmark: a crisp specular on its domes and spires, and a cool shade. 0 is flat." />
        <Num name="boardSheenStrength" label="Board sheen" title="A fine tooth and a low satin sheen on the board, faded in as the camera comes in close. 0 is smooth." />
        <p className="muted">Landmarks are built brick by brick when the camera crosses a zoom: a ring of small cubes at the base, then up a level, round again. Zooming further does not change it; coming back out resets it.</p>
        <Num name="landmarkRevealFrom" label="Build at zoom" title="The zoom where the landmarks appear and start building. They keep building by the clock, not by more zoom." />
        <Num name="landmarkBuildSeconds" label="Build time" title="Seconds to build a landmark from its base to its top." />
        <Num name="landmarkBuildCube" label="Cube size" title="The size of one build cube, as a share of the model's width. Smaller is finer bricks and a longer build." />
        <h3>Facility badges</h3>
        <p className="muted">The factory, harbor and airbase badge splits into its three triangles as you zoom in. Each drifts toward its model on the board and fades before the closest zoom.</p>
        <Num name="facilitySplitFrom" label="Split from" title="The zoom where the badge starts to split apart." />
        <Num name="facilityFadeEnd" label="Gone by" title="The zoom where the split badges have faded away. Keep it a little under the closest zoom." />
        <Num name="facilitySplitSpread" label="Spread" title="How far apart the triangles drift, in badge widths. 0 leaves them together." />
        <h3>Faction tint</h3>
        <p className="muted">The faction colour over the diorama's ground: none at the diorama, up to its most at the mid zoom, a little stronger along the edge of each faction's land. Picking a unit in a combat phase pushes it to full.</p>
        <Num name="factionTintMax" label="Tint opacity" title="The faction tint at the mid zoom. 0.45 is 45%." />
        <Num name="factionTintBrightness" label="Tint brightness" title="The tint's brightness at the mid zoom. 1 is the faction's own colour." />
        <Num name="factionTintSaturation" label="Tint saturation" title="The tint's saturation at the mid zoom. 0 is grey, 1 is the faction's own colour." />
        <Num name="factionBorderBrightness" label="Border brightness" title="The border line against the faction's colour. Under 1 is darker, so it reads on the tint." />
        <Num name="factionBorderWidth" label="Border width" title="The border line's width on the screen, in px, at every zoom." />
        <Num name="factionBorderKeyline" label="Border keyline" title="The pale line either side of the border's dark core. 0 is none." />
        <Num name="factionRegionShift" label="Region shift" title="How much lighter or darker each territory sits than its neighbours, so they part without a line. 0.05 is up to 5%." />
        <Num name="factionBorderFloor" label="Border at diorama" title="How much of its strength a border keeps at the closest zoom, where the tint has gone. 0.5 is half; 1 keeps it fully." />
        <Num name="factionBorderFadeFrom" label="Border fade from" title="How close the zoom is, 0 to 1, where borders start to ease toward that floor." />
        <Num name="factionBorderFadeTo" label="Border at floor by" title="How close the zoom is where borders reach the floor." />
        <Num name="factionBorderOpacity" label="Border opacity" title="A multiplier on the border's opacity. 1 is as set below." />
        <Num name="factionBoostUSSR" label="Boost, USSR" title="How much stronger the Soviet tint is than the rest at the mid zoom. 1.05 is 5% stronger." />
        <Num name="factionBoostGER" label="Boost, Germany" title="How much stronger the German tint is. 1.6 is 60% stronger." />
        <Num name="factionBoostJAP" label="Boost, Japan" title="How much stronger the Japanese tint is. 1.15 is 15% stronger." />
        <Num name="factionBoostUS" label="Boost, USA" title="How much stronger the American tint is. 1.7 is 70% stronger." />
        <Num name="factionBoostUK" label="Boost, Britain" title="How much stronger the British tint is. 1.5 is 50% stronger." />
        <Num name="factionTintFadeFrom" label="Fade from" title="How close the zoom is, 0 to 1, where the tint starts to fade." />
        <Num name="factionTintFadeTo" label="Gone by" title="How close the zoom is where the tint is gone: the diorama's." />
        <Num name="factionEdgeBoost" label="Edge boost" title="How much stronger the tint is along the outer edge of a faction's land. 0 is even." />
        <Num name="factionBorderInner" label="Border, same" title="The tint of a border between two territories of one faction." />
        <Num name="factionBorderFrontier" label="Border, frontier" title="The tint of a border where two factions' land meet. A coast does not count." />
        <h3>Region roundels</h3>
        <p className="muted">A flat faction roundel under every land territory with a GDP value, in its owner's colours. Move or resize one in the placement editor (X).</p>
        <Flag name="enableRegionRoundels" label="Region roundels" title="Show the owner's roundel under each territory that has a GDP value" />
        <Num name="roundelRadiusShare" label="Size" title="How much of an infantry base's width the roundel takes. Under 1 is smaller than the base." off={!mapVisuals.enableRegionRoundels} />
        <Num name="roundelHeight" label="Thickness" title="The roundel's thickness against its radius. Small is a flat enamel plate." off={!mapVisuals.enableRegionRoundels} />


        <h3>Mountains</h3>
        <Flag name="enableShogunMountains" label="Sculpted ranges" title="Sculpted ranges in Switzerland, the Himalayas, and Persia" />
        <Flag name="enableScatteredRocks" label="Loose rock models" title="Loose peak and boulder models along the world's ranges" />
        <Num name="mountainPeakHeight" label="Height" title="Height of the tallest summit, in world units. Held under two fifths of an infantry figure." off={!mapVisuals.enableShogunMountains} />
        <Num name="mountainReliefHeight" label="Range rise" title="A multiplier on how far the sculpted ranges rise off the land. 1 is the range height as set." />
        <Num name="mountainRidgeSharpness" label="Ridges" title="0 is a smooth dome. 1 is a ridged massif." off={!mapVisuals.enableShogunMountains} />
        <Num name="mountainSnowLine" label="Snow line" title="Share of the summit's height where the snow is half on" off={!mapVisuals.enableShogunMountains} />
        <Num name="mountainSnowBlend" label="Snow blend" title="How gradually the snow comes on. Small is a hard line." off={!mapVisuals.enableShogunMountains} />
        <Num name="mountainSnowGlow" label="Snow glow" title="How far sunlit snow goes past white. Needs Glow on, under Light and lens." off={!mapVisuals.enableShogunMountains} />

        <h3>Surface</h3>
        <Flag name="enablePbrSurface" label="Grain" title="Fine relief on the land and the cliffs, lit by the sun" />
        <Num name="pbrNormalStrength" label="Depth" title="Depth of the grain" off={!mapVisuals.enablePbrSurface} />
        <Num name="pbrRoughness" label="Roughness" title="1 is matt flock. Lower puts a satin sheen on the ground toward the sun." off={!mapVisuals.enablePbrSurface} />
        <Num name="pbrTilingScale" label="Tiling" title="World units the grain covers before it repeats" off={!mapVisuals.enablePbrSurface} />
        <Num name="terrainSaturation" label="Saturation" title="Saturation of the land's colour under the grain. 1 is the printed colour." off={!mapVisuals.enablePbrSurface} />

        <h3>Rivers</h3>
        <Flag name="enableRivers" label="Rivers" title="Rivers drawn on the land" />
        <Num name="riverWidth" label="Width" title="Width of a river, in world units" off={!mapVisuals.enableRivers} />
        <Num name="riverDepthShade" label="Depth" title="How much darker the middle of the channel is than its edge" off={!mapVisuals.enableRivers} />
        <Num name="riverBankHighlight" label="Banks" title="Strength of the sunlit and the shaded bank" off={!mapVisuals.enableRivers} />

        <h3>Roads</h3>
        <Flag name="enableRoads" label="Roads" title="Roads between the capitals and the factories" />
        <Num name="roadWidth" label="Width" title="Width of a road, in world units" off={!mapVisuals.enableRoads} />
        <Num name="roadOpacity" label="Opacity" title="Opacity of a road at the close zoom. It fades out toward the fitted board." off={!mapVisuals.enableRoads} />
        <Num name="roadWarmth" label="Warmth" title="0 is bone ivory. 1 is warm parchment." off={!mapVisuals.enableRoads} />

        <h3>Sun</h3>
        <Flag name="enableSunTransit" label="Sun crosses the table" title="The sun crosses the table. Off, it stops where it stands." />
        <Num name="sunCycleSpeed" label="Speed" title="How fast the day passes. 1 is a day in five minutes." off={!mapVisuals.enableSunTransit} />
        <Num name="sunMinElevation" label="Low" title="Height of the sun at either end of the day, in degrees" />
        <Num name="sunMaxElevation" label="High" title="Height of the sun at noon, in degrees" />
        <Num name="sunWarmthIntensity" label="Warmth" title="Amber of the sunlight. 1 is the shipped amber at the ends of the day. 0 is white light." />
        <Num name="ambientFillIntensity" label="Fill" title="Strength of the cool fill from the sky" />

        <h3>Shadows</h3>
        <Flag name="enableShadows" label="Cast shadows" title="Shadows cast by the sun. The map's size is Shadows, under Light and lens." />
        <Num name="shadowOpacity" label="Opacity" title="How dark a full cast shadow is" off={!mapVisuals.enableShadows} />
        <Num name="shadowSoftness" label="Softness" title="Width of a shadow's edge, in texels of the shadow map" off={!mapVisuals.enableShadows} />
        <Num name="shadowNormalBias" label="Bias" title="How far off a slope the shadow map is read, in world units" off={!mapVisuals.enableShadows} />
        <Flag name="shadowOnBasesOnly" label="Figure shadows on bases only" title="A figure's shadow falls on bases and counters and leaves the ground clean" />

        <h3>Bases</h3>
        <Flag name="enable3DBases" label="3D bases" title="The bases under land stacks are real models on the board, lit and shadowed by the sun. Ships keep their ring." />
        <Num name="plinthHeight" label="Base height" title="Height of a base against its radius." off={!mapVisuals.enable3DBases} />
        <Num name="plinthBevel" label="Base bevel" title="Width of the pale bevel round the top edge of a base, as a share of its radius." off={!mapVisuals.enable3DBases} />
        <Num name="squadRadius2" label="Pair base" title="A pair's base against a single unit's. 1.25 is a quarter wider." off={!mapVisuals.enable3DBases} />
        <Num name="squadRadius3Plus" label="Crowd base" title="The base of three or more against a single unit's. 1.45 is nearly half again as wide." off={!mapVisuals.enable3DBases} />
        <Num name="plinthSpecular" label="Base shine" title="How hard the sun catches a base's bevel and rim: a crisp specular and a warm key against a cool shade. 0 is flat." off={!mapVisuals.enable3DBases} />
        <Num name="vehicleDioramaScale" label="Vehicle and aircraft size" title="How large tanks, guns and aircraft stand in the close-up, against their old size. Lower keeps them from dwarfing the landmarks." />
        <Num name="vehiclePlinthRadius" label="Vehicle base radius" title="The radius of a tank's or gun's base against an infantry base's. Lower hugs the treads." off={!mapVisuals.enable3DBases} />
        <Num name="contactAoStrength" label="Contact shadow" title="The soft dark footprint under each figure on its base. 0 is none." off={!mapVisuals.enable3DBases} />
        <Num name="squadSpread" label="Squad spread" title="How far apart the figures of a pair or a crowd stand on their base. 1 is the shipped formation." off={!mapVisuals.enable3DBases} />
        <Flag name="enableBasePlinths" label="Turned bases" title="A dark wood base with a brass ring under each standing figure" />
        <Num name="plinthRimWidth" label="Rim" title="Width of the dark rim, as a share of the base" off={!mapVisuals.enableBasePlinths} />
        <Num name="plinthRoughness" label="Roughness" title="0 is polished, 1 is matt. Between, the rim carries a satin highlight." off={!mapVisuals.enableBasePlinths} />
        <Num name="plinthBrassIntensity" label="Brass" title="0 is a ring in the faction's colour. 1 is brass." off={!mapVisuals.enableBasePlinths} />
      </Fold>
      <Fold title="Shogun">
        <p className="muted">The Shogun ground. Wash, grain, borders, and the frontline. The switches above still gate the relief, the water, the smoke, and the trees.</p>
        <label className="coast-slider">
          <span>Preset</span>
          <select
            aria-label="Shogun preset"
            value={visualPresetOf(mapVisuals)}
            onChange={(event) => {
              const name = event.target.value as VisualPresetName;
              if (name in VISUAL_PRESETS) {
                applyVisuals(VISUAL_PRESETS[name]);
              }
            }}
          >
            <option value="shogun">Shogun</option>
            <option value="faux-pixel-cartography">Pixel chart</option>
            <option value="solid">Solid</option>
            <option value="plain">Plain</option>
            {visualPresetOf(mapVisuals) === "custom" ? <option value="custom">Custom</option> : null}
          </select>
          <span />
        </label>
        <Slider label="Wash near" min={0} max={1} value={mapVisuals.factionWashClose} onChange={(value) => setVisual("factionWashClose", value)} />
        <Slider label="Wash far" min={0} max={1} value={mapVisuals.factionWashFar} onChange={(value) => setVisual("factionWashFar", value)} />
        <Slider label="Grain" min={0} max={2} value={mapVisuals.terrainGrainStrength} onChange={(value) => setVisual("terrainGrainStrength", value)} />
        <label className="coast-slider">
          <span>Friendly</span>
          <select
            aria-label="Friendly border"
            value={mapVisuals.friendlyBorderStyle}
            onChange={(event) => setVisual("friendlyBorderStyle", event.target.value as FriendlyBorderStyle)}
          >
            <option value="subtle-dashed">Subtle dashed</option>
            <option value="solid">Solid</option>
            <option value="hidden">Hidden</option>
          </select>
          <span />
        </label>
        <label className="coast-slider">
          <span>Frontline</span>
          <select
            aria-label="Frontline"
            value={mapVisuals.frontlineStyle}
            onChange={(event) => setVisual("frontlineStyle", event.target.value as FrontlineStyle)}
          >
            <option value="dual-ink">Dual ink</option>
            <option value="classic">Classic band</option>
            <option value="hidden">Hidden</option>
          </select>
          <span />
        </label>
        <label className="coast-slider">
          <span>Highlight</span>
          <select
            aria-label="Highlight"
            value={mapVisuals.highlightMode}
            onChange={(event) => setVisual("highlightMode", event.target.value as HighlightRule)}
          >
            <option value="click-and-drag">Click and drag</option>
            <option value="always-hover">Always hover</option>
            <option value="off">Off</option>
          </select>
          <span />
        </label>
        <Slider label="Watercolour" min={0} max={2} value={mapVisuals.watercolorIntensity} onChange={(value) => setVisual("watercolorIntensity", value)} />
        <Slider label="Legal hint" min={0} max={1} value={mapVisuals.legalHintStrength} onChange={(value) => setVisual("legalHintStrength", value)} />
        <label className="art-tune-flag">
          <input type="checkbox" checked={mapVisuals.showBiomeProps} onChange={(event) => setVisual("showBiomeProps", event.target.checked)} />
          Trees, mountains, buildings
        </label>
        <label className="art-tune-flag">
          <input type="checkbox" checked={mapVisuals.showBattleSmoke} onChange={(event) => setVisual("showBattleSmoke", event.target.checked)} />
          Battle and factory smoke
        </label>
        <Slider label="Smoke" min={0} max={0.6} value={mapVisuals.smokeOpacity} onChange={(value) => setVisual("smokeOpacity", value)} />
        <label className="art-tune-flag">
          <input type="checkbox" checked={mapVisuals.showCoastalWaves} onChange={(event) => setVisual("showCoastalWaves", event.target.checked)} />
          Coastal waves
        </label>
        <label className="art-tune-flag">
          <input type="checkbox" checked={mapVisuals.enableDoF} onChange={(event) => setVisual("enableDoF", event.target.checked)} />
          Depth of field
        </label>
        <Slider label="Bokeh" min={0} max={1.5} value={mapVisuals.bokehIntensity} onChange={(value) => setVisual("bokehIntensity", value)} />
        <label className="art-tune-flag">
          <input
            type="checkbox"
            checked={mapVisuals.sunSweep}
            disabled={mapVisuals.sunCycle !== "animated"}
            onChange={(event) => setVisual("sunSweep", event.target.checked)}
          />
          Sun sweeps through the day
        </label>
        <Slider
          label="Azimuth"
          title="Where the sun holds while it does not sweep. The Sun setting under Light and lens must be moving."
          min={-50}
          max={50}
          value={mapVisuals.sunAzimuth}
          disabled={mapVisuals.sunSweep || mapVisuals.sunCycle !== "animated"}
          display={`${Math.round(mapVisuals.sunAzimuth)}°`}
          onChange={(value) => setVisual("sunAzimuth", value)}
        />
        <Slider label="Rim" min={0} max={1} value={mapVisuals.unitRim} onChange={(value) => setVisual("unitRim", value)} />
        <Slider label="Shadow" min={0} max={0.6} value={mapVisuals.contactShadow} onChange={(value) => setVisual("contactShadow", value)} />
        <button type="button" onClick={() => resetVisuals()}>
          Reset shogun
        </button>
      </Fold>
    </section>
  );
}
