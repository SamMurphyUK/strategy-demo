// The two inspectors of the battle stage. Both read and write the live look (skins/battleVisualConfig.ts `battleLook`) and show every value.
//
//   Z   colour, sky and light: the time of day, every sky stop per stage, the sun's rim and halo, the moon's glow, the horizon mist and desaturation,
//       the trench and ground tints, the three sea bands, the swash and the bob.
//   X   position and scale: the trench lines and their convergence, the horizon band, the sun and moon, the cloud layer and its share, the beach and
//       sea strip, and the rank-column anchors.
//
// Z and X are free: the battle screen uses only Escape, K, F10, Space and Enter. A key is ignored while a field has the focus. "Copy JSON" copies the
// look in the config's own shape. No React state is touched by the frame loop: the engine reads `battleLook` directly.
import { useEffect, useState, useSyncExternalStore } from "react";
import { battleLookJson, getBattleLookRev, lookLeaves, resetBattleLook, setBattleLook, subscribeBattleLook } from "../skins/battleVisualConfig";

type Leaf = { path: string; value: string | number | boolean };

const Z_PREFIXES = ["time.", "sky.", "sun.halo", "sun.haloRim", "sun.noon", "sun.low", "moon.color", "moon.glowColor", "moon.light", "stars.", "horizon.mist", "horizon.desat", "horizon.mistColor", "horizon.treeColor", "horizon.townColor", "ground.", "sea."];

/** A leaf belongs to the Z panel when it is a colour or a light value; everything else (positions and sizes) belongs to X. */
export function inColourPanel(path: string): boolean {
  return Z_PREFIXES.some((p) => path === p || path.startsWith(p));
}

const PANEL: React.CSSProperties = {
  position: "absolute",
  top: 36,
  width: 300,
  maxHeight: "calc(100% - 56px)",
  overflowY: "auto",
  background: "rgba(30,27,24,0.94)",
  border: "1px solid #645355",
  color: "#DDCF99",
  font: "11px 'Courier New', monospace",
  padding: 8,
  pointerEvents: "auto",
  zIndex: 30,
};

function Field({ leaf }: { leaf: Leaf }) {
  const { path, value } = leaf;
  const label = <span style={{ flex: 1, opacity: 0.85 }}>{path}</span>;
  if (typeof value === "boolean") {
    return (
      <label style={{ display: "flex", gap: 6, margin: "2px 0" }}>
        {label}
        <input type="checkbox" checked={value} onChange={(e) => setBattleLook(path, e.target.checked)} />
      </label>
    );
  }
  if (typeof value === "string") {
    return (
      <label style={{ display: "flex", gap: 6, margin: "2px 0", alignItems: "center" }}>
        {label}
        <input type="color" value={value} onChange={(e) => setBattleLook(path, e.target.value.toUpperCase())} style={{ width: 34, height: 18, padding: 0 }} />
        <span style={{ width: 62, textAlign: "right" }}>{value}</span>
      </label>
    );
  }
  const hour = path === "time.hour";
  return (
    <label style={{ display: "flex", gap: 6, margin: "2px 0", alignItems: "center" }}>
      {label}
      {hour && <input type="range" min={0} max={24} step={0.05} value={value} onChange={(e) => setBattleLook(path, Number(e.target.value))} style={{ width: 90 }} />}
      <input
        type="number"
        step="any"
        value={Number.isFinite(value) ? Number(value.toFixed(3)) : 0}
        onChange={(e) => setBattleLook(path, Number(e.target.value))}
        style={{ width: 64, background: "#1E1B18", color: "#DDCF99", border: "1px solid #645355", font: "inherit" }}
      />
    </label>
  );
}

function Panel(props: { title: string; side: "left" | "right"; leaves: Leaf[]; onClose(): void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ ...PANEL, [props.side]: 8 }} data-battle-inspector={props.title}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <strong>{props.title}</strong>
        <span>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(battleLookJson()).then(() => setCopied(true))} style={btn}>
            {copied ? "Copied" : "Copy JSON"}
          </button>{" "}
          <button type="button" onClick={resetBattleLook} style={btn}>
            Reset
          </button>{" "}
          <button type="button" onClick={props.onClose} style={btn}>
            ×
          </button>
        </span>
      </div>
      {props.leaves.map((leaf) => (
        <Field key={leaf.path} leaf={leaf} />
      ))}
    </div>
  );
}

const btn: React.CSSProperties = { background: "#4B3D44", border: "1px solid #846D59", color: "#DDCF99", cursor: "pointer", font: "inherit", padding: "1px 6px" };

export default function BattleInspectors() {
  useSyncExternalStore(subscribeBattleLook, getBattleLookRev, getBattleLookRev);
  const [open, setOpen] = useState<{ z: boolean; x: boolean }>(() => {
    const q = new URLSearchParams(window.location.search).get("inspect") ?? "";
    return { z: q.includes("z"), x: q.includes("x") };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) {
        return;
      }
      if (e.key === "z" || e.key === "Z") {
        setOpen((o) => ({ ...o, z: !o.z }));
      } else if (e.key === "x" || e.key === "X") {
        setOpen((o) => ({ ...o, x: !o.x }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const leaves = lookLeaves();
  return (
    <>
      {open.z && <Panel title="Z · colour, sky and light" side="left" leaves={leaves.filter((l) => inColourPanel(l.path))} onClose={() => setOpen((o) => ({ ...o, z: false }))} />}
      {open.x && <Panel title="X · position and scale" side="right" leaves={leaves.filter((l) => !inColourPanel(l.path))} onClose={() => setOpen((o) => ({ ...o, x: false }))} />}
    </>
  );
}
