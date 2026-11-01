// Campaign cues from /AUDIO. The folder also holds embark, torpedo, amphibious landing,
// carpet bombing, and flyover. Those stay unused: the map has no control that matches them.

const BASE = "/AUDIO/";

export const CampaignCue = {
  pickup: "03_chit_pickup.wav",
  order: "04_tactical_order.wav",
  snap: "05_chit_snap.wav",
  mobilize: "06_factory_mobilize.wav",
  assault: "10_combat_assault.wav",
  retreat: "12_tactical_retreat.wav",
  touchdown: "13_airfield_touchdown.wav",
  victory: "15_victory_fanfare.wav",
} as const;

export type CampaignCueName = keyof typeof CampaignCue;

const cache = new Map<string, HTMLAudioElement>();

export function playCampaignCue(name: CampaignCueName): void {
  const file = CampaignCue[name];
  let audio = cache.get(file);
  if (!audio) {
    audio = new Audio(`${BASE}${file}`);
    audio.preload = "auto";
    cache.set(file, audio);
  }
  audio.currentTime = 0;
  void audio.play().catch(() => {});
}

/** A completed move. Planes landing in noncombat use the touchdown; every other order is the tactical stamp. */
export function moveCue(category: string, phase: string): CampaignCueName {
  return category === "air" && phase === "noncombat_move" ? "touchdown" : "order";
}
