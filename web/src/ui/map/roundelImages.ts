// The faction roundels as images, for the 2D canvas that draws the pixel zoom tier. They load once, at start, so the first paint has them.
import { ROUNDEL_IDS, type RoundelId, roundelUrl } from "../../components/ui/RoundelBadge";

const images = new Map<RoundelId, HTMLImageElement>();

/** Starts loading every roundel. Safe to call twice. */
export function preloadRoundelImages(): void {
  if (typeof Image === "undefined") {
    return;
  }
  for (const id of ROUNDEL_IDS) {
    if (images.has(id)) {
      continue;
    }
    const image = new Image();
    image.decoding = "async";
    image.src = roundelUrl(id);
    images.set(id, image);
  }
}

/** The roundel, once it has loaded; null until then. */
export function roundelImage(id: RoundelId): HTMLImageElement | null {
  const image = images.get(id);
  return image && image.complete && image.naturalWidth > 0 ? image : null;
}
