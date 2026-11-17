import type { PartAsset, RosterFactionId, UnitSkeletonBlueprint } from "./skeletonSchema";

/** The promoted infantry sheet is the faction's style reference for later bakes. */
const HERO_BLUEPRINT: Record<RosterFactionId, string> = {
  GER: "ger_infantry_43",
  USSR: "ussr_infantry_43",
  UK: "uk_infantry_43",
  US: "us_infantry_43",
  JAP: "jap_infantry_43",
  MINOR: "minor_infantry_43",
};

export function factionHeroBlueprintId(factionId: RosterFactionId): string {
  return HERO_BLUEPRINT[factionId];
}

/** File path relative to the Vite root (the web/ folder). */
export function promotedRepoPath(factionId: RosterFactionId, blueprintId: string): string {
  return `public/assets/units/promoted/${factionId}/${blueprintId}.png`;
}

/** URL the dev server serves from public/. */
export function promotedPublicUrl(factionId: RosterFactionId, blueprintId: string): string {
  return `/assets/units/promoted/${factionId}/${blueprintId}.png`;
}

/**
 * Hero first, then the blueprint's own plates. The hero occupies reference_images[0].
 * At most nine images go to Retro Diffusion.
 */
export function referencePlatesFor(
  blueprint: UnitSkeletonBlueprint,
  heroAvailable: boolean,
): string[] {
  const own = (blueprint.referencePlatePaths ?? []).filter((plate) => plate !== "");
  const hero = promotedRepoPath(blueprint.factionId, factionHeroBlueprintId(blueprint.factionId));
  const plates = heroAvailable ? [hero, ...own.filter((plate) => plate !== hero)] : own;
  return plates.slice(0, 9);
}

/** Historical line plus each part's fragment. The picture sits on a plain white field. */
export function bakePrompt(blueprint: UnitSkeletonBlueprint, parts: Record<string, PartAsset>): string {
  const fragments = blueprint.nodes
    .map((node) => parts[node.partId]?.promptFragment ?? "")
    .filter((fragment) => fragment !== "");
  return `${blueprint.historicalEraTag}. ${fragments.join(". ")}. Plain white background.`;
}

export function freshSeeds(count: number): number[] {
  const seeds = new Set<number>();
  while (seeds.size < count) {
    seeds.add(1 + Math.floor(Math.random() * 999_999));
  }
  return [...seeds];
}
