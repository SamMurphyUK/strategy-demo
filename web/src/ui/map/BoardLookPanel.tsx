import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
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
  getVisualRev,
  mapVisuals,
  resetVisuals,
  setVisual,
  subscribeVisuals,
  VISUAL_PRESETS,
  visualPresetOf,
  type FrontlineStyle,
  type FriendlyBorderStyle,
  type HighlightRule,
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

/** Picture controls for the campaign board. Z opens the panel that holds this. */
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

  return (
    <section aria-label="Board look">
      <h2>Board</h2>
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
          <input type="checkbox" checked={mapVisuals.sunSweep} onChange={(event) => setVisual("sunSweep", event.target.checked)} />
          Sun sweeps through the day
        </label>
        <Slider
          label="Azimuth"
          min={-50}
          max={50}
          value={mapVisuals.sunAzimuth}
          disabled={mapVisuals.sunSweep}
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
