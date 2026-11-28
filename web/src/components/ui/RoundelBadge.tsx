import type { CSSProperties } from "react";
import { resolveFaction, type FactionKey } from "../../ui/theme/factionPalette";
import "./RoundelBadge.css";

/** The roundels in public/assets/roundels, written by scripts/generate_roundels.py. */
export const ROUNDEL_IDS = ["us", "uk", "ussr", "ger", "jap", "ita", "chn", "anz", "fra", "neutral_true", "neutral_allied", "neutral_axis"] as const;
export type RoundelId = (typeof ROUNDEL_IDS)[number];

export type RoundelSize = "sm" | "md" | "lg";

/** Edge length in px of each size. */
export const ROUNDEL_PX: Record<RoundelSize, number> = { sm: 20, md: 32, lg: 48 };

const BY_FACTION: Record<FactionKey, RoundelId> = {
  US: "us",
  UK: "uk",
  USSR: "ussr",
  GER: "ger",
  JAP: "jap",
  ITA: "ita",
  CHI: "chn",
  ANZ: "anz",
  FRA: "fra",
  NEUTRAL: "neutral_true",
};

const BY_NAME: Record<string, RoundelId> = {
  italy: "ita",
  ita: "ita",
  china: "chn",
  chn: "chn",
  anz: "anz",
  anzac: "anz",
  australia: "anz",
  france: "fra",
  fra: "fra",
  neutral_allied: "neutral_allied",
  neutral_axis: "neutral_axis",
};

/** The roundel for a game faction id. Anything unknown gets the neutral one. */
export function roundelFor(factionId: string | null | undefined): RoundelId {
  const name = String(factionId ?? "").trim().toLowerCase();
  const named = BY_NAME[name];
  if (named) {
    return named;
  }
  if ((ROUNDEL_IDS as readonly string[]).includes(name)) {
    return name as RoundelId;
  }
  return BY_FACTION[resolveFaction(factionId)];
}

export function roundelUrl(id: RoundelId): string {
  return `${import.meta.env.BASE_URL}assets/roundels/${id}.svg`;
}

export interface RoundelBadgeProps {
  /** A roundel id, or any game faction id (it is mapped with `roundelFor`). */
  faction: RoundelId | string;
  size?: RoundelSize;
  /** A pulsing dashed crimson ring: the territory is being fought over. */
  contested?: boolean;
  /** A small brass star pip: the capital. */
  capital?: boolean;
  /** Accessible name. Defaults to the roundel's id; pass "" for a decorative badge. */
  label?: string;
  className?: string;
}

/** A faction roundel at 20, 32 or 48 px, with optional contested and capital overlays. */
export function RoundelBadge({ faction, size = "md", contested = false, capital = false, label, className }: RoundelBadgeProps) {
  const id = roundelFor(faction);
  const px = ROUNDEL_PX[size];
  const style = { "--roundel-px": `${px}px` } as CSSProperties;
  const name = label ?? id.replace(/_/g, " ");
  const classes = ["roundel-badge", `roundel-${size}`, contested ? "is-contested" : "", capital ? "is-capital" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <span className={classes} style={style} role={name === "" ? "presentation" : "img"} aria-label={name === "" ? undefined : name}>
      <img className="roundel-face" src={roundelUrl(id)} width={px} height={px} alt="" draggable={false} />
      {contested && (
        <svg className="roundel-contested" viewBox="0 0 48 48" aria-hidden="true">
          <circle cx="24" cy="24" r="22.5" fill="none" stroke="#a8243a" strokeWidth="3" strokeDasharray="5 3.5" strokeLinecap="butt" />
        </svg>
      )}
      {capital && (
        <svg className="roundel-capital" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="9" fill="#2a2023" stroke="#a88a5e" strokeWidth="1.5" />
          <polygon points="10,3.6 11.9,8 16.6,8.3 13,11.3 14.2,15.9 10,13.3 5.8,15.9 7,11.3 3.4,8.3 8.1,8" fill="#d2a53a" />
        </svg>
      )}
    </span>
  );
}
