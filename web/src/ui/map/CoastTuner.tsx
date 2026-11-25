import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ringSpan } from "./coastRelief";
import {
  coastTuneSortOrigin,
  effectiveCliffLift,
  landmassSpanAt,
  sortLandRegionsByProximity,
  type CoastTune,
} from "./coastTune";
import { getCoastTune, lockCoastTune, resetCoastTune, setCoastTune, subscribeCoastTune } from "./coastTuneStore";
import { FIGURE_CLASSES, FIGURE_CLASS_LABEL, type FigureClass } from "./figureScale";
import { getFigureScales, setFigureClassScale, subscribeFigureScale } from "./figureScaleStore";
import type { RegionShape, Vec2 } from "./geometry";
import type { MasterLand } from "./svgLandLoader";
import { BoardLookPanel } from "./BoardLookPanel";
import { getDrawFlags, getDrawSample, setDrawFlag, subscribeDrawFlags, subscribeDrawSample, type DrawFlags } from "./renderDebug";

interface Props {
  regions: readonly RegionShape[];
  land: MasterLand | null;
  viewCenter: Vec2;
}

function formatNum(value: number): string {
  if (!Number.isFinite(value)) {
    return "";
  }
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function regionSpan(region: RegionShape, land: MasterLand | null): number {
  if (land) {
    const onLand = landmassSpanAt(land.polygons, region.anchor) ?? landmassSpanAt(land.polygons, region.centroid);
    if (onLand !== null) {
      return onLand;
    }
  }
  return ringSpan(region.points.map((point) => [point.x, point.y]));
}

function TuneSlider(props: {
  label: string;
  title?: string;
  min: number;
  max: number;
  value: number;
  disabled?: boolean;
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
      <span className="mono">{formatNum(props.value)}</span>
    </label>
  );
}

const LOD_NAME = ["far", "stamps", "figures"] as const;

function DrawReadout() {
  const sample = useSyncExternalStore(subscribeDrawSample, getDrawSample, getDrawSample);
  const flags = useSyncExternalStore(subscribeDrawFlags, getDrawFlags, getDrawFlags);
  const row = (key: keyof DrawFlags, label: string, title: string) => (
    <label title={title}>
      <input type="checkbox" checked={flags[key]} onChange={(event) => setDrawFlag(key, event.target.checked)} />
      <span>{label}</span>
    </label>
  );
  const ready = sample.px !== "";
  const fps = ready ? sample.fps.toFixed(0) : "–";
  const frame = ready ? sample.frameMs.toFixed(1) : "–";
  return (
    <>
      <h2>Draw</h2>
      <p className="draw-readout">
        {fps} fps · {frame} ms · worst {ready ? sample.worstMs.toFixed(0) : "–"} ms
      </p>
      <p className="muted">
        paint {sample.paintMs.toFixed(1)} · land {sample.landMs.toFixed(1)} · shore {sample.shoreMs.toFixed(1)} · figures{" "}
        {sample.figureMs.toFixed(1)} · arrows {sample.arrowMs.toFixed(1)} · idle {sample.idleMs.toFixed(1)}
      </p>
      <p className="muted">
        {LOD_NAME[sample.lod] ?? sample.lod} · zoom {sample.zoom.toFixed(2)}
        {sample.px !== "" ? ` · ${sample.px}` : ""}
      </p>
      <div className="draw-flags">
        {row("anims", "Anims", "Idle figure frames. The picture stays on the last frame.")}
        {row("cliffs", "Cliffs", "The cliff face under the coast. One swept face for each lift.")}
        {row("stamp", "Stamp", "The old cliff, filled once for every pixel of the drop. This is the slow zoom.")}
        {row("shore", "Shore", "The blurred shoreline. The land stays.")}
        {row("figures", "Figures", "Tokens, upright sprites, and the vector stage.")}
        {row("sheet", "Sheet", "Zoomed figures are copies of one picture for each kind. Off, every figure is its own SVG node.")}
        {row("arrows", "Arrows", "Move arrows, battle marks, and the hover stroke.")}
      </div>
    </>
  );
}

/** Debug coast panel. Z opens it. The sliders paint on the next frame; Lock in writes the file. */
export function CoastTuner({ regions, land, viewCenter }: Props) {
  const tune = useSyncExternalStore(subscribeCoastTune, getCoastTune, getCoastTune);
  const figures = useSyncExternalStore(subscribeFigureScale, getFigureScales, getFigureScales);
  const [figureClass, setFigureClass] = useState<FigureClass>("infantry");
  const [selected, setSelected] = useState<string[]>([]);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [locking, setLocking] = useState(false);

  useEffect(() => {
    if (selected.length === 0) {
      setAnchorId(null);
      return;
    }
    setAnchorId((anchor) => anchor ?? selected[0]);
  }, [selected]);

  // A landmass is measured once. The list is sorted again as the camera moves, and that part is cheap.
  const spans = useMemo(
    () => regions.filter((region) => region.type === "land").map((region) => ({ region, span: regionSpan(region, land) })),
    [regions, land],
  );

  const rows = useMemo(() => {
    const spots = spans.map(({ region, span }) => {
      const over = tune.cliffOverrides[region.id];
      return {
        id: region.id,
        x: region.anchor.x,
        y: region.anchor.y,
        lift: effectiveCliffLift(span, region.id, tune.cliffOverrides),
        overridden: typeof over === "number" && Number.isFinite(over),
      };
    });
    const origin = coastTuneSortOrigin(spots, viewCenter, anchorId);
    return sortLandRegionsByProximity(spots, origin);
  }, [spans, tune, viewCenter.x, viewCenter.y, anchorId]);

  const chosen = selected.flatMap((id) => {
    const row = rows.find((item) => item.id === id);
    return row ? [row] : [];
  });
  const selectedLift = chosen[0]?.lift ?? 1;
  const mixed = chosen.some((row) => Math.abs(row.lift - selectedLift) > 0.0001);

  const setNumber = (key: Exclude<keyof CoastTune, "cliffOverrides">, value: number) => {
    setCoastTune({ ...tune, [key]: value });
    setStatus("");
  };

  const toggle = (id: string) => {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const setSelectedLift = (lift: number) => {
    if (selected.length === 0) {
      return;
    }
    const cliffOverrides = { ...tune.cliffOverrides };
    for (const id of selected) {
      cliffOverrides[id] = lift;
    }
    setCoastTune({ ...tune, cliffOverrides });
    setStatus("");
  };

  const useSize = () => {
    const cliffOverrides = { ...tune.cliffOverrides };
    for (const id of selected) {
      delete cliffOverrides[id];
    }
    setCoastTune({ ...tune, cliffOverrides });
    setStatus("");
  };

  const lock = () => {
    if (locking) {
      return;
    }
    setLocking(true);
    setStatus("Writing…");
    void lockCoastTune().then((error) => {
      setLocking(false);
      setStatus(error || "Locked in.");
    });
  };

  return (
    <aside className="panel coast-tune" aria-label="Coast tuner" onPointerDown={(event) => event.stopPropagation()}>
      <DrawReadout />
      <BoardLookPanel />
      <h2>Coast</h2>
      <h3>Figures</h3>
      <label className="coast-slider">
        <span>Class</span>
        <select aria-label="Unit class" value={figureClass} onChange={(event) => setFigureClass(event.target.value as FigureClass)}>
          {FIGURE_CLASSES.map((id) => (
            <option key={id} value={id}>
              {FIGURE_CLASS_LABEL[id]}
            </option>
          ))}
        </select>
        <span />
      </label>
      <TuneSlider
        label="Size"
        title="Height of this class when the map is zoomed in to the figures"
        min={0.4}
        max={4}
        value={figures[figureClass]}
        onChange={(value) => setFigureClassScale(figureClass, value)}
      />
      <h3>Waves</h3>
      <TuneSlider label="Reach" title="Amplitude in screen pixels" min={0} max={16} value={tune.reachPx} onChange={(value) => setNumber("reachPx", value)} />
      <TuneSlider label="Period" title="Seconds for one swell" min={0.5} max={24} value={tune.periodS} onChange={(value) => setNumber("periodS", value)} />
      <TuneSlider label="Wavelength" title="Distance along the shore between crests, in map units" min={8} max={240} value={tune.wavelength} onChange={(value) => setNumber("wavelength", value)} />
      <TuneSlider label="Grain" title="Fixed break in the ring, in screen pixels. It does not animate." min={0} max={2} value={tune.grainPx} onChange={(value) => setNumber("grainPx", value)} />
      <TuneSlider label="Rest" title="Resting bloom distance, in screen pixels" min={0} max={40} value={tune.bloomRestPx} onChange={(value) => setNumber("bloomRestPx", value)} />
      <TuneSlider label="Brush" title="Bloom brush width, in screen pixels" min={0} max={48} value={tune.bloomBrushPx} onChange={(value) => setNumber("bloomBrushPx", value)} />
      <TuneSlider label="Blur" title="Bloom blur, in screen pixels" min={0} max={32} value={tune.bloomBlurPx} onChange={(value) => setNumber("bloomBlurPx", value)} />
      <TuneSlider label="Opacity" title="Bloom stroke alpha" min={0} max={1} value={tune.bloomAlpha} onChange={(value) => setNumber("bloomAlpha", value)} />
      <h3>Cliffs</h3>
      <TuneSlider label="Height" title="Global cliff lip" min={0} max={2} value={tune.cliffLip} onChange={(value) => setNumber("cliffLip", value)} />
      <p className="muted">Land, nearest the view first. After a pick, neighbors stay next to it.</p>
      <ul className="coast-region-list">
        {rows.map((region) => {
          const on = selected.includes(region.id);
          return (
            <li key={region.id}>
              <button type="button" className={on ? "active" : undefined} aria-pressed={on} onClick={() => toggle(region.id)}>
                <span>{region.id}</span>
                <span className="mono">{region.overridden ? formatNum(region.lift) : `size ${formatNum(region.lift)}`}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <TuneSlider
        label={mixed ? "Selected *" : "Selected"}
        min={0}
        max={2}
        value={selectedLift}
        disabled={chosen.length === 0}
        onChange={setSelectedLift}
      />
      <div className="coast-tune-actions">
        <button type="button" onClick={useSize} disabled={chosen.length === 0}>
          Use size
        </button>
        <button type="button" className="primary" onClick={lock} disabled={locking}>
          Lock in
        </button>
        <button type="button" onClick={() => { resetCoastTune(); setStatus("Shipped defaults."); }}>
          Reset
        </button>
      </div>
      <p className="muted">{status || "Z hides this."}</p>
    </aside>
  );
}
