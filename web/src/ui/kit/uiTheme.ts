// Switchable HUD colour variant and type face. "faction" is the existing look, tinted by whoever is
// playing. Every other variant is one colour of the fading-16 strip, run through the same chrome
// recipe the faction tint uses, so the panels stay translucent over the board and the hairlines,
// wells and ink keep their relationships. Pure UI state: nothing here touches the simulation.

import { useEffect, useSyncExternalStore, type CSSProperties } from "react";
import { landChrome, mix } from "../map/factionChrome";

export type UiTheme = "faction" | "oxblood" | "slate" | "verdigris" | "umber" | "olive";
export type UiType = "pixel" | "thin" | "pack";
const TYPES: UiType[] = ["pixel", "thin", "pack"];

/** `land` is the fading-16 colour the chrome is cut from. */
export const UI_THEMES: { id: UiTheme; label: string; land: string }[] = [
  { id: "faction", label: "Faction", land: "" },
  { id: "oxblood", label: "Oxblood", land: "#9C524E" },
  { id: "slate", label: "Slate", land: "#4E5463" },
  { id: "verdigris", label: "Verdigris", land: "#5B7D73" },
  { id: "umber", label: "Umber", land: "#846D59" },
  { id: "olive", label: "Olive", land: "#7D7B62" },
];

const THEME_KEY = "strategy-demo.uiTheme";
const TYPE_KEY = "strategy-demo.uiType";
const LAB_KEY = "strategy-demo.uiLab";

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The choice still holds for this visit.
  }
}

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const IDS = UI_THEMES.map((item) => item.id);

/** `/ui-lab` or `?uiLab=1` opens the comparison overlay for the visit. */
function labRequested(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.pathname.replace(/\/+$/, "") === "/ui-lab" || new URLSearchParams(window.location.search).get("uiLab") === "1";
}

const browser = typeof window !== "undefined";
let theme: UiTheme = browser ? readStored<UiTheme>(THEME_KEY, IDS, "faction") : "faction";
let type: UiType = browser ? readStored<UiType>(TYPE_KEY, TYPES, "pixel") : "pixel";
let lab = browser ? labRequested() || readStored(LAB_KEY, ["0", "1"], "0") === "1" : false;

export function setUiTheme(next: UiTheme): void {
  theme = next;
  writeStored(THEME_KEY, next);
  emit();
}

export function cycleUiTheme(): void {
  setUiTheme(IDS[(IDS.indexOf(theme) + 1) % IDS.length]);
}

export function setUiType(next: UiType): void {
  type = next;
  writeStored(TYPE_KEY, next);
  emit();
}

export function setUiLab(open: boolean): void {
  lab = open;
  writeStored(LAB_KEY, open ? "1" : "0");
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useUiTheme = (): UiTheme => useSyncExternalStore(subscribe, () => theme, () => "faction" as UiTheme);
export const useUiType = (): UiType => useSyncExternalStore(subscribe, () => type, () => "pixel" as UiType);
export const useUiLab = (): boolean => useSyncExternalStore(subscribe, () => lab, () => false);

/** U cycles the colour variants. T cycles Silkscreen / thin pixel / font pack. Shift+U shows or hides the lab. Ignored while typing. */
export function useUiThemeHotkeys(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (event.ctrlKey || event.metaKey || event.altKey || (key !== "u" && key !== "t")) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (key === "t") setUiType(TYPES[(TYPES.indexOf(type) + 1) % TYPES.length]);
      else if (event.shiftKey) setUiLab(!lab);
      else cycleUiTheme();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Campaign variables for a variant, inline so they beat the faction tint. `faction` returns nothing. */
export function uiThemeChrome(current: UiTheme): CSSProperties | undefined {
  const land = UI_THEMES.find((item) => item.id === current)?.land ?? "";
  if (land === "") return undefined;
  // Less ink than the faction tint, so the hue survives in the frame and wells. Oxblood stays on the
  // faction recipe: it is the look the Soviet tint already gives.
  if (current === "oxblood") return landChrome(land);
  const ink = mix(land, "#16181e", 0.8);
  return {
    "--land": land,
    "--frame": mix(land, ink, 0.55),
    "--well": mix(land, ink, 0.32),
    "--brass": mix(land, "#f3ecdf", 0.18),
    "--gold": mix(land, "#f3ecdf", 0.5),
    "--gold-text": mix(land, "#f3ecdf", 0.82),
    "--parchment": mix(land, "#f3ecdf", 0.66),
    "--button": mix(land, ink, 0.45),
    "--button-edge": mix(land, "#f3ecdf", 0.2),
    "--stamp": mix(land, "#b85a4a", 0.5),
    "--chit-active": mix(land, ink, 0.2),
    "--teal": mix(land, "#f3ecdf", 0.78),
  } as CSSProperties;
}
