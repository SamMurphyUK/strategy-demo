import { Anchor, Factory, Plane, Star } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Emblem } from "./emblemData";

const ICONS = { capital: Star, factory: Factory, port: Anchor, airbase: Plane } as const;

/** One compact emblem. Its words open above it in a tooltip that is drawn outside the inspector, which clips what spills from it. */
function EmblemChip({ emblem }: { emblem: Emblem }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const Icon = ICONS[emblem.id];
  const show = () => {
    const box = ref.current?.getBoundingClientRect();
    if (box) {
      setTip({ x: box.left + box.width / 2, y: box.top });
    }
  };
  const host = tip ? document.querySelector<HTMLElement>(".campaign") : null;
  return (
    <span
      ref={ref}
      className={["hud-emblem-chip", `is-${emblem.id}`, emblem.major ? "is-major" : "", emblem.impaired ? "is-impaired" : ""].filter(Boolean).join(" ")}
      tabIndex={0}
      role="img"
      aria-label={emblem.detail}
      onMouseEnter={show}
      onFocus={show}
      onMouseLeave={() => setTip(null)}
      onBlur={() => setTip(null)}
    >
      <Icon size={emblem.id === "capital" ? 13 : 14} strokeWidth={emblem.major ? 2.6 : 2} fill={emblem.id === "capital" ? "currentColor" : "none"} aria-hidden="true" />
      {tip && host
        ? createPortal(
            <div className="hud-emblem-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
              {emblem.detail}
            </div>,
            host,
          )
        : null}
    </span>
  );
}

/** The territory's capital, factory, port and airbase as small icon emblems, grouped to sit beside its flag. */
export function RegionEmblems({ emblems }: { emblems: readonly Emblem[] }) {
  if (emblems.length === 0) {
    return null;
  }
  return (
    <span className="hud-emblems" aria-label="Facilities">
      {emblems.map((emblem) => (
        <EmblemChip key={emblem.id} emblem={emblem} />
      ))}
    </span>
  );
}
