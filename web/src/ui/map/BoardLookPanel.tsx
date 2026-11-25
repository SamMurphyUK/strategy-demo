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
  return (
    <label className="art-tune-flag" title={props.title}>
      <input
        type="checkbox"
        aria-label={props.title ?? props.label}
        checked={mapVisuals[props.name]}
        onChange={(event) => setVisual(props.name, event.target.checked)}
      />
      {props.label}
    </label>
  );
}

/** A slider and a number box for one setting. Both hold the same value, inside the setting's range. */
function Num(props: { name: NumberKey; label: string; title: string; unit?: string; off?: boolean }) {
  const [min, max] = VISUAL_RANGES[props.name] ?? [0, 1];
  const value = mapVisuals[props.name];
  return (
    <label className="coast-slider" title={props.title}>
      <span>{props.label}</span>
      <input
        type="range"
        aria-label={props.title}
        min={min}
        max={max}
        step="any"
        value={value}
        disabled={props.off}
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
        disabled={props.off}
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
        <Num name="seaWaveRings" label="Wave rings" title="The rings of surf that roll in around the coast. 0 is none." />
        <Num name="seaSheenStrength" label="Sea shine" title="Brightness of the sun glitter on the sea. 0 is none." />
        <Num name="seaFarVisibility" label="Far shine" title="How much of the waves and the glitter is left with the camera zoomed all the way out. 0 is none, 1 is all of it." />
        <Flag name="enableSoftLand" label="Soft land" title="Close in, where the detailed figures stand, the land eases from the pixel chart to a soft posterized wash." />
        <Num name="softLandFrom" label="Soft from" title="The zoom where the land starts to soften. The sprites arrive at 3.8." off={!mapVisuals.enableFauxPixelMap || !mapVisuals.enableSoftLand} />
        <Num name="softLandTo" label="Soft to" title="The zoom where the land is fully soft." off={!mapVisuals.enableFauxPixelMap || !mapVisuals.enableSoftLand} />
        <Num name="softLandDither" label="Soft dither" title="Dither left on the soft land. 0 is none, 1 is as the strategic chart." off={!mapVisuals.enableFauxPixelMap || !mapVisuals.enableSoftLand} />
        <Num name="softLandSaturation" label="Soft colour" title="Colour left on the soft land. 1 is as the strategic chart." off={!mapVisuals.enableFauxPixelMap || !mapVisuals.enableSoftLand} />
        <Num name="softLandValueBand" label="Soft light" title="Light and shade left on the soft land. 1 is as the strategic chart." off={!mapVisuals.enableFauxPixelMap || !mapVisuals.enableSoftLand} />
        <Num name="softLandBrush" label="Brush" title="How far brush strokes wander the soft bands. 0 is clean bands." off={!mapVisuals.enableFauxPixelMap || !mapVisuals.enableSoftLand} />
        <Flag name="regionalPaletteDetail" label="Climate palettes" title="Each territory takes the palette of its climate: temperate, boreal, arid, or tropical. Off, the whole land is one temperate ramp." />

        <h3>Mountains</h3>
        <Flag name="enableShogunMountains" label="Sculpted ranges" title="Sculpted ranges in Switzerland, the Himalayas, and Persia" />
        <Flag name="enableScatteredRocks" label="Loose rock models" title="Loose peak and boulder models along the world's ranges" />
        <Num name="mountainPeakHeight" label="Height" title="Height of the tallest summit, in world units. Held under two fifths of an infantry figure." off={!mapVisuals.enableShogunMountains} />
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
