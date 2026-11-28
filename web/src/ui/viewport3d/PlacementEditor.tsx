// The placement editor: the "X" button on the 3D board and the panel it opens.
//
// With it open, click a tree, a peak, a roof, or a landmark to pick it, or pick a landmark from the
// list. Then move it along x, y, and z in neat steps, make it bigger or smaller by the same ratio on
// every side, turn it, and lock it. "Save to project" writes src/ui/viewport3d/placements.json (dev
// server only), so a locked placement is part of the next build. Until then the edits are a draft in
// this browser.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoardFrame } from "../map/boardLayer";
import { screenToWorld, worldToScreen } from "../map/viewMath";
import {
  type Axis,
  type Edit,
  isEdit,
  LANDMARKS,
  nudge,
  PLACEMENTS_ROUTE,
  propKey,
  type PlacedLandmark,
  type Placements,
  resize,
  serializePlacements,
  setLocked,
  turn,
} from "./placements";
import { PROP_KINDS, type PropPlan } from "./propPlan";
import type { PlacedRoundel } from "./roundelPlacement";

export interface PlacementEditorProps {
  /** The latest painted frame, for the view the picks and the marker are read against. */
  frame(): BoardFrame | null;
  /** The element the picks are read from. */
  surface(): HTMLElement | null;
  plan: PropPlan;
  landmarks: readonly PlacedLandmark[];
  /** The flat faction roundels under the territories with an IPC value. They are moved, resized, turned and locked like a landmark. */
  roundels?: readonly PlacedRoundel[];
  placements: Placements;
  onChange(next: Placements): void;
  /** Throws away the draft and returns to the saved file. */
  onRevert(): void;
  onClose(): void;
}

const STEPS = [0.25, 1, 4] as const;
const PICK_PX = 16;

interface Pickable {
  key: string;
  label: string;
  x: number;
  y: number;
  r: number;
}

function labelOf(key: string): string {
  const [kind, id] = key.split(":");
  if (kind === "landmark") {
    return LANDMARKS.find((spec) => spec.id === id)?.label ?? id;
  }
  if (kind === "roundel") {
    return `Roundel, ${id}`;
  }
  return `${kind} ${Number(id) + 1}`;
}

/** The X button. */
export function PlacementButton({ open, onToggle }: { open: boolean; onToggle(): void }) {
  return (
    <button
      type="button"
      className="placement-x"
      title="Placement editor: move, resize, and lock the trees, peaks, roofs, and landmarks"
      aria-pressed={open}
      onClick={onToggle}
      style={{
        position: "fixed",
        left: 12,
        bottom: 12,
        zIndex: 40,
        width: 34,
        height: 34,
        font: "700 16px monospace",
        color: open ? "#2b2124" : "#e9dfc9",
        background: open ? "#ddcf99" : "#4b3d44",
        border: "1px solid #ddcf99",
        borderRadius: 4,
        cursor: "pointer",
      }}
    >
      X
    </button>
  );
}

export function PlacementEditor(props: PlacementEditorProps) {
  const { plan, landmarks, placements, onChange, onClose } = props;
  const [selected, setSelected] = useState<string | null>(null);
  const [step, setStep] = useState<(typeof STEPS)[number]>(1);
  const [status, setStatus] = useState("");
  const [, tick] = useState(0);
  const live = useRef({ ...props, selected, step });
  live.current = { ...props, selected, step };

  const edit: Edit | undefined = selected ? placements[selected] : undefined;
  const locked = edit?.locked === true;

  const change = useCallback(
    (key: string, next: Edit) => {
      const out = { ...live.current.placements };
      if (isEdit(next)) {
        out[key] = next;
      } else {
        delete out[key];
      }
      live.current.onChange(out);
    },
    [],
  );

  const move = useCallback(
    (axis: Axis, sign: 1 | -1) => {
      const { selected: key, step: size, placements: all } = live.current;
      if (key) {
        change(key, nudge(all[key], axis, sign * size));
      }
    },
    [change],
  );
  const grow = useCallback(
    (sign: 1 | -1) => {
      const { selected: key, placements: all } = live.current;
      if (key) {
        change(key, resize(all[key], sign));
      }
    },
    [change],
  );
  const spin = useCallback(
    (sign: 1 | -1) => {
      const { selected: key, placements: all } = live.current;
      if (key) {
        change(key, turn(all[key], sign));
      }
    },
    [change],
  );
  const toggleLock = useCallback(() => {
    const { selected: key, placements: all } = live.current;
    if (key) {
      change(key, setLocked(all[key], all[key]?.locked !== true));
    }
  }, [change]);

  // The marker follows the board as it pans and zooms.
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => (n + 1) % 1e6), 80);
    return () => window.clearInterval(id);
  }, []);

  // Pick by clicking the board. The click still reaches the map, so nothing here blocks a drag.
  useEffect(() => {
    const surface = props.surface();
    if (!surface) {
      return;
    }
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) {
        return;
      }
      const frame = live.current.frame();
      if (!frame) {
        return;
      }
      const rect = surface.getBoundingClientRect();
      const at = screenToWorld(frame.view, { x: e.clientX - rect.left, y: e.clientY - rect.top });
      const one = screenToWorld(frame.view, { x: e.clientX - rect.left + PICK_PX, y: e.clientY - rect.top });
      const reach = Math.abs(one.x - at.x);
      let best: Pickable | null = null;
      let bestGap = Infinity;
      const consider = (item: Pickable) => {
        const gap = Math.hypot(item.x - at.x, item.y - at.y) - item.r;
        if (gap < reach && gap < bestGap) {
          best = item;
          bestGap = gap;
        }
      };
      for (const kind of PROP_KINDS) {
        live.current.plan.props[kind].forEach((prop, index) => {
          if (Math.abs(prop.x - at.x) < reach * 4 && Math.abs(prop.y - at.y) < reach * 4) {
            consider({ key: propKey(kind, index), label: kind, x: prop.x, y: prop.y, r: prop.scale * 0.4 });
          }
        });
      }
      for (const mark of live.current.landmarks) {
        consider({ key: mark.key, label: mark.spec.label, x: mark.instance.x, y: mark.instance.y, r: mark.instance.scale * 0.6 });
      }
      for (const disc of live.current.roundels ?? []) {
        consider({ key: disc.key, label: disc.label, x: disc.instance.x, y: disc.instance.y, r: disc.instance.scale * 0.6 });
      }
      if (best) {
        setSelected((best as Pickable).key);
      }
    };
    surface.addEventListener("pointerdown", onDown);
    surface.addEventListener("pointerup", onUp);
    return () => {
      surface.removeEventListener("pointerdown", onDown);
      surface.removeEventListener("pointerup", onUp);
    };
  }, []);

  // Keys: arrows move on x and y, PageUp and PageDown on z, plus and minus resize, brackets turn.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) {
        return;
      }
      const handled = (fn: () => void) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      };
      switch (e.key) {
        case "ArrowLeft":
          return handled(() => move("x", -1));
        case "ArrowRight":
          return handled(() => move("x", 1));
        case "ArrowUp":
          return handled(() => move("y", -1));
        case "ArrowDown":
          return handled(() => move("y", 1));
        case "PageUp":
          return handled(() => move("z", 1));
        case "PageDown":
          return handled(() => move("z", -1));
        case "+":
        case "=":
          return handled(() => grow(1));
        case "-":
        case "_":
          return handled(() => grow(-1));
        case "[":
          return handled(() => spin(-1));
        case "]":
          return handled(() => spin(1));
        case "l":
        case "L":
          return handled(toggleLock);
        case "Escape":
          return handled(() => (live.current.selected ? setSelected(null) : onClose()));
        default:
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [move, grow, spin, toggleLock, onClose]);

  const save = async () => {
    setStatus("Saving...");
    try {
      const response = await fetch(PLACEMENTS_ROUTE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serializePlacements(live.current.placements)),
      });
      const body = (await response.json()) as { ok: boolean; error?: string; count?: number };
      setStatus(body.ok ? `Saved ${body.count ?? 0} placements to the project.` : (body.error ?? "Could not save."));
    } catch {
      setStatus("Saving needs the dev server. The draft is kept in this browser.");
    }
  };

  // The selected object's place on screen, for the marker.
  const frame = props.frame();
  const rect = props.surface()?.getBoundingClientRect();
  const marker = useMemo(() => {
    if (!selected || !frame || !rect) {
      return null;
    }
    let at: { x: number; y: number; r: number } | null = null;
    const mark = landmarks.find((item) => item.key === selected);
    const disc = props.roundels?.find((item) => item.key === selected);
    if (mark) {
      at = { x: mark.instance.x, y: mark.instance.y, r: mark.instance.scale * 0.6 };
    } else if (disc) {
      at = { x: disc.instance.x, y: disc.instance.y, r: disc.instance.scale * 0.6 };
    } else {
      const [kind, index] = selected.split(":");
      const prop = plan.props[kind as keyof PropPlan["props"]]?.[Number(index)];
      if (prop) {
        at = { x: prop.x, y: prop.y, r: prop.scale * 0.5 };
      }
    }
    if (!at) {
      return null;
    }
    const centre = worldToScreen(frame.view, at);
    const edge = worldToScreen(frame.view, { x: at.x + at.r, y: at.y });
    const radius = Math.max(10, Math.abs(edge.x - centre.x));
    return { x: rect.left + centre.x, y: rect.top + centre.y, r: radius };
  }, [selected, frame, rect, landmarks, props.roundels, plan]);

  const value = edit ?? { dx: 0, dy: 0, dz: 0, mult: 1, dturn: 0, locked: false };
  const row = (label: string, shown: string, minus: () => void, plus: () => void, titles: [string, string]) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "4px 0" }}>
      <span style={{ width: 44 }}>{label}</span>
      <button type="button" title={titles[0]} onClick={minus} disabled={!selected || locked} style={buttonStyle}>
        -
      </button>
      <span style={{ width: 62, textAlign: "center" }}>{shown}</span>
      <button type="button" title={titles[1]} onClick={plus} disabled={!selected || locked} style={buttonStyle}>
        +
      </button>
    </div>
  );

  return (
    <>
      {marker ? (
        <div
          style={{
            position: "fixed",
            left: marker.x - marker.r,
            top: marker.y - marker.r,
            width: marker.r * 2,
            height: marker.r * 2,
            border: `2px ${locked ? "solid" : "dashed"} #ddcf99`,
            borderRadius: "50%",
            pointerEvents: "none",
            zIndex: 39,
            boxShadow: "0 0 0 1px #4b3d44",
          }}
        />
      ) : null}
      <div
        style={{
          position: "fixed",
          left: 12,
          bottom: 54,
          zIndex: 40,
          width: 250,
          padding: 10,
          font: "12px monospace",
          color: "#e9dfc9",
          background: "rgba(43,33,36,0.94)",
          border: "1px solid #ddcf99",
          borderRadius: 4,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <strong>PLACEMENT EDITOR</strong>
          <button type="button" onClick={onClose} style={buttonStyle} title="Close (Esc)">
            x
          </button>
        </div>
        <select
          value={selected?.startsWith("landmark:") ? selected : ""}
          onChange={(e) => setSelected(e.target.value || null)}
          style={{ width: "100%", marginBottom: 6 }}
        >
          <option value="">Pick a landmark, or click an object</option>
          {landmarks.map((mark) => (
            <option key={mark.key} value={mark.key}>
              {mark.spec.label}
            </option>
          ))}
        </select>
        {(props.roundels?.length ?? 0) > 0 ? (
          <select
            value={selected?.startsWith("roundel:") ? selected : ""}
            onChange={(e) => setSelected(e.target.value || null)}
            style={{ width: "100%", marginBottom: 6 }}
          >
            <option value="">Pick a region roundel</option>
            {(props.roundels ?? []).map((disc) => (
              <option key={disc.key} value={disc.key}>
                {disc.label}
              </option>
            ))}
          </select>
        ) : null}
        <div style={{ marginBottom: 6 }}>{selected ? `${labelOf(selected)}${locked ? "  (locked)" : ""}` : "Nothing picked"}</div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ width: 44 }}>Step</span>
          {STEPS.map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => setStep(size)}
              style={{ ...buttonStyle, background: step === size ? "#ddcf99" : "#4b3d44", color: step === size ? "#2b2124" : "#e9dfc9" }}
            >
              {size}
            </button>
          ))}
        </div>
        {row("X", value.dx.toFixed(2), () => move("x", -1), () => move("x", 1), ["West (Left)", "East (Right)"])}
        {row("Y", value.dy.toFixed(2), () => move("y", -1), () => move("y", 1), ["North (Up)", "South (Down)"])}
        {row("Z", value.dz.toFixed(2), () => move("z", -1), () => move("z", 1), ["Lower (PageDown)", "Raise (PageUp)"])}
        {row("Size", `x${value.mult.toFixed(2)}`, () => grow(-1), () => grow(1), ["Smaller (-)", "Bigger (+)"])}
        {row("Turn", `${Math.round((value.dturn * 180) / Math.PI)} deg`, () => spin(-1), () => spin(1), ["Turn left ([)", "Turn right (])"])}
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button type="button" onClick={toggleLock} disabled={!selected} style={buttonStyle} title="Lock or unlock (L)">
            {locked ? "Unlock" : "Lock"}
          </button>
          <button
            type="button"
            disabled={!selected || locked || !edit}
            style={buttonStyle}
            onClick={() => {
              if (selected) {
                const out = { ...placements };
                delete out[selected];
                onChange(out);
              }
            }}
          >
            Reset
          </button>
          <button type="button" onClick={props.onRevert} style={buttonStyle} title="Throw away the draft and go back to the saved file">
            Revert
          </button>
        </div>
        <button type="button" onClick={save} style={{ ...buttonStyle, width: "100%", marginTop: 8 }} title="Writes src/ui/viewport3d/placements.json">
          Save to project
        </button>
        <div style={{ marginTop: 6, minHeight: 14, opacity: 0.85 }}>{status}</div>
        <div style={{ marginTop: 4, opacity: 0.6 }}>Arrows move X/Y, PgUp/PgDn Z, +/- size, [ ] turn, L lock.</div>
      </div>
    </>
  );
}

const buttonStyle = {
  font: "12px monospace",
  color: "#e9dfc9",
  background: "#4b3d44",
  border: "1px solid #8c7c79",
  borderRadius: 3,
  padding: "2px 8px",
  cursor: "pointer",
} as const;
