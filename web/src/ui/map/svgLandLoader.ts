// Fetches the master land SVG and turns every <path> into one Path2D stencil and one MultiPolygon.
import type { Rect } from "./geometry";
import { combinePathData, parseViewBox } from "./landSvg";
import { landFromPathData, type MultiPolygon } from "./regionClip";

export const LAND_SVG_URL = `${import.meta.env.BASE_URL}assets/ne_110m_land_FINAL.svg`;

export interface MasterLand {
  /** Every land path in the SVG, in viewBox units. Fill with nonzero so lakes (opposite winding) stay open. */
  masterLandPath: Path2D;
  /** The same land as boolean-ready geometry: what region cutters are clipped against. */
  polygons: MultiPolygon;
  /** The SVG viewBox. Map world space is this rectangle. */
  viewBox: Rect;
  pathCount: number;
}

export function parseLandSvg(svgText: string): MasterLand {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("Land SVG is not valid XML");
  }
  const svg = doc.documentElement;
  const data = Array.from(doc.getElementsByTagNameNS("*", "path"))
    .map((el) => el.getAttribute("d") ?? "")
    .filter((d) => d.trim() !== "");
  if (data.length === 0) {
    throw new Error("Land SVG has no <path> elements");
  }
  const viewBox = parseViewBox(
    svg.getAttribute("viewBox"),
    Number.parseFloat(svg.getAttribute("width") ?? ""),
    Number.parseFloat(svg.getAttribute("height") ?? ""),
  );
  return {
    masterLandPath: new Path2D(combinePathData(data)),
    polygons: landFromPathData(data),
    viewBox,
    pathCount: data.length,
  };
}

export async function loadMasterLand(url: string = LAND_SVG_URL): Promise<MasterLand> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url} (${response.status})`);
  }
  return parseLandSvg(await response.text());
}
