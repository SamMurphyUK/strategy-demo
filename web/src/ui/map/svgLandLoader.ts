// Fetches the master land SVG and turns every <path> into one Path2D stencil and one MultiPolygon.
import type { Rect } from "./geometry";
import { parseViewBox } from "./landSvg";
import { landFromPathData, multiPolygonPathData, type FillRule, type MultiPolygon } from "./regionClip";

export const LAND_SVG_URL = `${import.meta.env.BASE_URL}assets/ne_110m_land_FINAL_02.svg`;

export interface MasterLand {
  /**
   * The land silhouette in viewBox units, built from `polygons` so a fill of this path and a fill of
   * the territory polygons are the same shape. Fill and clip it with evenodd: holes are sub-paths.
   */
  masterLandPath: Path2D;
  /** The same outline as one SVG path string, in viewBox units. */
  pathData: string;
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
  const paths = Array.from(doc.getElementsByTagNameNS("*", "path")).filter((el) => (el.getAttribute("d") ?? "").trim() !== "");
  if (paths.length === 0) {
    throw new Error("Land SVG has no <path> elements");
  }
  const viewBox = parseViewBox(
    svg.getAttribute("viewBox"),
    Number.parseFloat(svg.getAttribute("width") ?? ""),
    Number.parseFloat(svg.getAttribute("height") ?? ""),
  );
  const polygons: MultiPolygon = [];
  for (const el of paths) {
    polygons.push(...landFromPathData([el.getAttribute("d") ?? ""], fillRuleOfElement(el)));
  }
  const pathData = multiPolygonPathData(polygons);
  return {
    masterLandPath: new Path2D(pathData),
    pathData,
    polygons,
    viewBox,
    pathCount: paths.length,
  };
}

/** The path's own fill-rule, else the nearest ancestor's, else the SVG default (nonzero). */
function fillRuleOfElement(el: Element): FillRule {
  let node: Element | null = el;
  while (node) {
    const rule = node.getAttribute("fill-rule");
    if (rule === "evenodd" || rule === "nonzero") {
      return rule;
    }
    node = node.parentElement;
  }
  return "nonzero";
}

export async function loadMasterLand(url: string = LAND_SVG_URL): Promise<MasterLand> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url} (${response.status})`);
  }
  const text = await response.text();
  const head = text.trimStart().slice(0, 64).toLowerCase();
  if (head.startsWith("<!doctype html") || head.startsWith("<html")) {
    throw new Error(
      `Could not load ${url}: the server returned the app page instead of the SVG. The file on disk was not served.`,
    );
  }
  return parseLandSvg(text);
}
