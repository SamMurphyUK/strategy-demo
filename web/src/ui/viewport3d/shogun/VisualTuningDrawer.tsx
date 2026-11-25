// The Shogun board's corner controls: Fit map, and the "Visuals / Art Tuning" drawer.
//
// The drawer edits the visual store (../../map/mapVisualConfig.ts). The board reads that store in
// its frame loop, so nothing here renders the board: this component is the only React reader.
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  applyVisuals,
  getVisualRev,
  type MapVisualConfig,
  mapVisuals,
  resetVisuals,
  setVisual,
  subscribeVisuals,
  VISUAL_PRESETS,
  VISUAL_RANGES,
  type VisualPresetName,
  visualPresetJson,
  visualPresetOf,
} from "../../map/mapVisualConfig";

type NumberKey = { [K in keyof MapVisualConfig]: MapVisualConfig[K] extends number ? K : never }[keyof MapVisualConfig];
type FlagKey = { [K in keyof MapVisualConfig]: MapVisualConfig[K] extends boolean ? K : never }[keyof MapVisualConfig];
type ChoiceKey = "friendlyBorderStyle" | "frontlineStyle" | "highlightMode";

const PRESET_LABEL: Record<VisualPresetName, string> = { shogun: "Shogun", solid: "Solid", plain: "Plain" };

function num(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, "");
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

function Slider(props: { label: string; title: string; name: NumberKey; display?(value: number): string; disabled?: boolean }) {
  const [min, max] = VISUAL_RANGES[props.name];
  const value = mapVisuals[props.name];
  return (
    <label className="coast-slider" title={props.title}>
      <span>{props.label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step="any"
        value={value}
        disabled={props.disabled}
        onChange={(event) => setVisual(props.name, Number(event.target.value))}
      />
      <span className="mono">{props.display ? props.display(value) : num(value)}</span>
    </label>
  );
}

function Toggle(props: { label: string; title: string; name: FlagKey }) {
  return (
    <label className="art-tune-flag" title={props.title}>
      <input type="checkbox" checked={mapVisuals[props.name]} onChange={(event) => setVisual(props.name, event.target.checked)} />
      {props.label}
    </label>
  );
}

function Choice<K extends ChoiceKey>(props: { label: string; title: string; name: K; options: readonly (readonly [MapVisualConfig[K], string])[] }) {
  return (
    <label className="coast-slider" title={props.title}>
      <span>{props.label}</span>
      <select
        aria-label={props.title}
        value={mapVisuals[props.name]}
        onChange={(event) => setVisual(props.name, event.target.value as MapVisualConfig[K])}
      >
        {props.options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Drawer({ onClose }: { onClose(): void }) {
  useSyncExternalStore(subscribeVisuals, getVisualRev, getVisualRev);
  const [copied, setCopied] = useState("");
  const preset = visualPresetOf(mapVisuals);

  const copy = () => {
    const text = visualPresetJson(mapVisuals);
    const done = (note: string) => {
      setCopied(note);
      window.setTimeout(() => setCopied(""), 1600);
    };
    if (!navigator.clipboard) {
      done("Clipboard unavailable");
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => done("Copied"),
      () => done("Clipboard unavailable"),
    );
  };

  return (
    <aside className="panel coast-tune art-tune" aria-label="Visuals / Art Tuning" onPointerDown={(event) => event.stopPropagation()}>
      <h2>Visuals / Art Tuning</h2>
      <label className="coast-slider">
        <span>Preset</span>
        <select
          aria-label="Visual preset"
          value={preset}
          onChange={(event) => {
            const name = event.target.value;
            if (name in VISUAL_PRESETS) {
              applyVisuals(VISUAL_PRESETS[name as VisualPresetName]);
            }
          }}
        >
          {(Object.keys(VISUAL_PRESETS) as VisualPresetName[]).map((name) => (
            <option key={name} value={name}>
              {PRESET_LABEL[name]}
            </option>
          ))}
          {preset === "custom" ? <option value="custom">Custom</option> : null}
        </select>
      </label>

      <Fold title="Ground" startOpen>
        <Slider label="Wash near" title="Share of the faction colour over the ground at the closest zoom" name="factionWashClose" />
        <Slider label="Wash far" title="Share of the faction colour over the ground at the fitted board" name="factionWashFar" />
        <Slider label="Grain" title="Paper tooth and contour lines on the land" name="terrainGrainStrength" />
        <Toggle label="Trees, mountains, buildings" title="Biome props, close in" name="showBiomeProps" />
      </Fold>

      <Fold title="Borders" startOpen>
        <Choice
          label="Friendly"
          title="The line between two territories of one faction"
          name="friendlyBorderStyle"
          options={[
            ["subtle-dashed", "Subtle dashed"],
            ["solid", "Solid"],
            ["hidden", "Hidden"],
          ]}
        />
        <Choice
          label="Frontline"
          title="The line between two factions at war"
          name="frontlineStyle"
          options={[
            ["dual-ink", "Dual ink"],
            ["classic", "Classic band"],
            ["hidden", "Hidden"],
          ]}
        />
      </Fold>

      <Fold title="Highlight" startOpen>
        <Choice
          label="Shows on"
          title="When a territory wears the watercolour edge"
          name="highlightMode"
          options={[
            ["click-and-drag", "Click and drag"],
            ["always-hover", "Always hover"],
            ["off", "Off"],
          ]}
        />
        <Slider label="Watercolour" title="Strength of the watercolour edge" name="watercolorIntensity" />
        <Slider
          label="Legal hint"
          title="How strongly every legal destination shows while a stack is picked up. 0 shows the hovered one only"
          name="legalHintStrength"
        />
      </Fold>

      <Fold title="Atmosphere">
        <Toggle label="Battle and factory smoke" title="Smoke over battles and chimneys, close in" name="showBattleSmoke" />
        <Slider label="Smoke" title="Opacity of the thickest part of a puff" name="smokeOpacity" disabled={!mapVisuals.showBattleSmoke} />
        <Toggle label="Coastal waves" title="Swell, surf, and foam" name="showCoastalWaves" />
        <Toggle label="Depth of field" title="The soft far edge of the close view" name="enableDoF" />
        <Slider label="Bokeh" title="Blur at the far edge of the screen, close in" name="bokehIntensity" disabled={!mapVisuals.enableDoF} />
      </Fold>

      <Fold title="Light">
        <Toggle label="Sun sweeps through the day" title="Off holds the sun at the azimuth below" name="sunSweep" />
        <Slider
          label="Azimuth"
          title="Where a held sun stands, in degrees east of north"
          name="sunAzimuth"
          display={(value) => `${Math.round(value)}°`}
          disabled={mapVisuals.sunSweep}
        />
      </Fold>

      <Fold title="Pieces">
        <Slider label="Rim" title="Dark edge around a piece" name="unitRim" />
        <Slider label="Shadow" title="Opacity of the shadow under a piece" name="contactShadow" />
      </Fold>

      <div className="coast-tune-actions">
        <button type="button" onClick={copy}>
          Copy Preset JSON
        </button>
        <button type="button" onClick={() => resetVisuals()}>
          Reset
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="muted" aria-live="polite">
        {copied}
      </p>
    </aside>
  );
}

/** True when the page asked for the drawer with `?tune=1`. */
function tuneRequested(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("tune") === "1";
  } catch {
    return false;
  }
}

export function ShogunControls({ onFit }: { onFit(): void }) {
  const [open, setOpen] = useState(tuneRequested);
  return (
    <>
      <div className="map-controls art-tune-controls">
        <button type="button" onClick={onFit}>
          Fit map
        </button>
        <button type="button" aria-pressed={open} onClick={() => setOpen((value) => !value)}>
          Visuals
        </button>
      </div>
      {open ? <Drawer onClose={() => setOpen(false)} /> : null}
    </>
  );
}
