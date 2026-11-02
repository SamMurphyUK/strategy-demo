// Faction battle themes. The files are General MIDI, played on a small built-in synth
// so the battle screen does not depend on a soundfont download.

import WebAudioTinySynth from "webaudio-tinysynth";
import { holdCampaignBattle, releaseCampaignBattle } from "../map/campaignMusic";
import { resolveFaction, type FactionKey } from "../theme/factionPalette";
import type { TheaterId } from "./combatTypes";

const THEME_URL: Partial<Record<FactionKey, string>> = {
  USSR: "/AUDIO/ost/themes/ussr.mid",
  GER: "/AUDIO/ost/themes/germany-war.mid",
  UK: "/AUDIO/ost/themes/uk-jerusalem.mid",
  US: "/AUDIO/ost/themes/usa-johnny.mid",
  JAP: "/AUDIO/ost/themes/japan-march.mid",
};

/** Sandbox theaters have no faction id. The attacker of each preset picks the theme. */
const THEATER_FACTION: Record<TheaterId, string> = {
  normandy: "usa",
  eastern: "ussr",
  north_africa: "uk",
  pacific: "usa",
  navy_test: "usa",
  air_strike_test: "usa",
};

const THEME_VOLUME = 0.7;
const FADE_SEC = 1.4;

let player: WebAudioTinySynth | null = null;
let activeUrl = "";
let loadedUrl = "";
let quiet = false;
let heldTick = 0;
let volumeNow = 0;
let fadeToken = 0;
let stopTimer = 0;

export function battleThemeFor(factionId: string | null | undefined, theater: TheaterId): string | null {
  if (factionId && resolveFaction(factionId) !== "NEUTRAL") {
    return THEME_URL[resolveFaction(factionId)] ?? null;
  }
  return THEME_URL[resolveFaction(THEATER_FACTION[theater])] ?? null;
}

/** Loop this theme under the battle and park the combat-phase bed until the battle closes. */
export async function startBattleTheme(url: string): Promise<void> {
  if (activeUrl === url && player) return;
  activeUrl = url;
  heldTick = 0;
  holdCampaignBattle();
  const synth = ensureSynth();
  if (!synth) return;
  try {
    const response = await fetch(url);
    if (!response.ok || activeUrl !== url) return;
    const bytes = await response.arrayBuffer();
    if (activeUrl !== url) return;
    synth.loadMIDI(bytes);
    synth.setLoop(1);
    loadedUrl = url;
    if (quiet) {
      synth.setMasterVol(0);
      volumeNow = 0;
      return;
    }
    beginPlayback(synth);
  } catch {
    // A theme that cannot be read leaves the battle silent.
  }
}

/** Stop the theme and bring the combat-phase bed back where it was parked. */
export function stopBattleTheme(): void {
  activeUrl = "";
  loadedUrl = "";
  window.clearTimeout(stopTimer);
  fadeToken += 1;
  silence(player);
  volumeNow = 0;
  releaseCampaignBattle();
}

/**
 * Silence the theme without dropping the combat-phase hold. Used for the victory piece,
 * the menu, and mute. Opening it again continues from the tick where it went quiet.
 */
export function setBattleThemeQuiet(next: boolean): void {
  if (next === quiet) return;
  quiet = next;
  const synth = player;
  if (!synth || activeUrl === "") return;
  try {
    if (next) {
      heldTick = synth.getPlayStatus().curTick;
      fadeTo(0);
      window.clearTimeout(stopTimer);
      stopTimer = window.setTimeout(() => {
        if (!quiet) return;
        silence(player);
      }, FADE_SEC * 1000 + 30);
      return;
    }
    window.clearTimeout(stopTimer);
    // The file may still be downloading. startBattleTheme plays it when it arrives.
    if (loadedUrl !== activeUrl) return;
    beginPlayback(synth);
  } catch {
    // A synth fault must not take down the battle screen.
  }
}

function beginPlayback(synth: WebAudioTinySynth): void {
  resumeSynth();
  synth.locateMIDI(heldTick);
  synth.playMIDI();
  fadeTo(THEME_VOLUME);
}

function silence(synth: WebAudioTinySynth | null): void {
  if (!synth) return;
  try {
    synth.stopMIDI();
    synth.setMasterVol(0);
  } catch {
    // The player may not have a song yet.
  }
}

function resumeSynth(): void {
  const audio = player?.getAudioContext();
  if (audio && audio.state === "suspended") void audio.resume();
}

function ensureSynth(): WebAudioTinySynth | null {
  if (player) return player;
  try {
    const created = new WebAudioTinySynth({ useReverb: 1, quality: 1, voices: 48 });
    created.setReverbLev(0.2);
    created.setMasterVol(0);
    const unlock = () => resumeSynth();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    player = created;
    resumeSynth();
    return created;
  } catch {
    return null;
  }
}

function fadeTo(target: number): void {
  const token = ++fadeToken;
  const start = volumeNow;
  const began = performance.now();
  const step = () => {
    if (token !== fadeToken) return;
    const t = Math.min(1, (performance.now() - began) / (FADE_SEC * 1000));
    volumeNow = start + (target - start) * t;
    player?.setMasterVol(volumeNow);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
