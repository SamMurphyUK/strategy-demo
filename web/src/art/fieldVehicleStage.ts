/** Camera, then the unit's scale, then one sprite pixel, then the traced picture. */

import type { UnitSkyLight } from "./unitLighting";

const SVG_NS = "http://www.w3.org/2000/svg";

let stageSerial = 0;

export interface VehicleStageCamera {
  cssWidth: number;
  cssHeight: number;
  camX: number;
  camY: number;
  viewScale: number;
  /** Height of a figure relative to a screen-facing drawing. Omitted means 1. */
  figureLean?: number;
}

export interface VehicleSvgPart {
  role: "tracks" | "torso" | "head" | "weapon" | "shadow";
  href: string;
  maskHref?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  resolution: number;
  /** Pivot for foreshortening / bank, in sprite pixels. */
  pivotX?: number;
  pivotY?: number;
  scaleX?: number;
  scaleY?: number;
  skewXDeg?: number;
  rotateDeg?: number;
  opacity?: number;
}

export interface VehicleSvgUnit {
  id: string;
  x: number;
  y: number;
  unitScale: number;
  rootX: number;
  rootY: number;
  /** +1 keeps the picture. -1 mirrors it around the feet before the turn. */
  face?: 1 | -1;
  /** Clockwise degrees around the feet, after the mirror. */
  turnDeg?: number;
  /**
   * Fade the part of this picture that falls inside the stage's shore veil.
   * The rest of the picture stays solid.
   */
  shoreFade?: boolean;
  /** Leans the picture toward the camera (+) or away (-), in degrees: it shortens the picture, as the board's lean does. */
  tiltDeg?: number;
  /** How far the hull sits below the water, in CSS pixels. The picture is cut there and a foam seam is drawn. */
  submergePx?: number;
  parts: VehicleSvgPart[];
}

/** Land silhouette used to fade the inland part of a ship. World-unit path, screen-pixel transforms. */
export interface ShoreVeil {
  path: string;
  transforms: string[];
  /** Opacity of the inland part, 0–1. */
  alpha: number;
}

interface UnitNode {
  /** Untransformed wrapper, so a screen-space shore mask lines up with the map. */
  veil: SVGGElement;
  group: SVGGElement;
  root: SVGGElement;
  signature: string;
  parts: SVGGElement[];
}

export interface VehicleStage {
  sync(camera: VehicleStageCamera, units: readonly VehicleSvgUnit[], light: UnitSkyLight | null): void;
  /** The land mask ships use when `shoreFade` is set. Pass null to drop it. */
  setShoreVeil(veil: ShoreVeil | null): void;
  clear(): void;
}

function signatureOf(parts: readonly VehicleSvgPart[]): string {
  return parts
    .map(
      (part) =>
        `${part.role}|${part.resolution}|${part.width}|${part.height}|${part.maskHref ? "m" : "o"}|${part.pivotX ?? 0}|${part.pivotY ?? 0}`,
    )
    .join(";");
}

function element<T extends SVGElement>(name: string): T {
  return document.createElementNS(SVG_NS, name) as T;
}

/** Show `href` without clearing the picture that is already on screen. A new file stays hidden until it loads. */
function showPicture(scale: SVGGElement, href: string, width: string, height: string): void {
  const images = [...scale.querySelectorAll("image")];
  let match = images.find((image) => image.getAttribute("href") === href) ?? null;
  if (!match) {
    const blank = images.find((image) => !image.getAttribute("href"));
    match = blank ?? element<SVGImageElement>("image");
    if (!blank) {
      match.setAttribute("preserveAspectRatio", "none");
      match.setAttribute("visibility", "hidden");
      scale.append(match);
    }
    const shown = match;
    shown.addEventListener(
      "load",
      () => {
        shown.setAttribute("data-ready", "1");
        if (shown.getAttribute("data-wanted") === "1") revealPicture(scale, shown);
      },
      { once: true },
    );
    shown.setAttribute("href", href);
    if (blank) shown.setAttribute("data-ready", "1");
  }
  for (const image of scale.querySelectorAll("image")) {
    if (image === match) image.setAttribute("data-wanted", "1");
    else image.removeAttribute("data-wanted");
  }
  match.setAttribute("width", width);
  match.setAttribute("height", height);
  if (match.getAttribute("data-ready") === "1") revealPicture(scale, match);
}

function revealPicture(scale: SVGGElement, shown: SVGImageElement): void {
  let mask: string | null = null;
  for (const image of scale.querySelectorAll("image")) {
    const own = image.getAttribute("mask");
    if (own) mask = own;
  }
  for (const image of scale.querySelectorAll("image")) {
    if (image === shown) {
      image.removeAttribute("visibility");
      if (mask) image.setAttribute("mask", mask);
    } else {
      image.setAttribute("visibility", "hidden");
      if (mask) image.removeAttribute("mask");
    }
  }
}

function affineTransform(part: VehicleSvgPart): string {
  const res = part.resolution > 0 ? 1 / part.resolution : 1;
  const scaleX = part.scaleX ?? 1;
  const scaleY = part.scaleY ?? 1;
  const skewX = part.skewXDeg ?? 0;
  const rotate = part.rotateDeg ?? 0;
  const pivotX = part.pivotX ?? 0;
  const pivotY = part.pivotY ?? 0;
  const bits = [`translate(${part.x} ${part.y})`];
  if (rotate !== 0 || skewX !== 0 || scaleX !== 1 || scaleY !== 1) {
    bits.push(`translate(${pivotX} ${pivotY})`);
    if (rotate !== 0) {
      bits.push(`rotate(${rotate})`);
    }
    if (skewX !== 0) {
      bits.push(`skewX(${skewX})`);
    }
    if (scaleX !== 1 || scaleY !== 1) {
      bits.push(`scale(${scaleX} ${scaleY})`);
    }
    bits.push(`translate(${-pivotX} ${-pivotY})`);
  }
  bits.push(`scale(${res})`);
  return bits.join(" ");
}

export function createVehicleStage(svg: SVGSVGElement): VehicleStage {
  svg.setAttribute("preserveAspectRatio", "none");
  svg.style.pointerEvents = "none";
  svg.style.overflow = "visible";
  const defs = element<SVGDefsElement>("defs");
  const camera = element<SVGGElement>("g");
  svg.replaceChildren(defs, camera);
  const units = new Map<string, UnitNode>();
  const filterId = `field-unit-light-${++stageSerial}`;
  const shoreId = `field-shore-${stageSerial}`;
  let lightKey = "";
  let shore: ShoreVeil | null = null;
  let shoreKey = "";
  let shoreCss = { w: 1, h: 1 };
  let figureLean = 1;

  const applyShore = () => {
    const mark = shore ? `${shore.path.slice(0, 32)}|${shore.path.length}|${shore.path.slice(-32)}` : "";
    const key = shore ? `${shoreCss.w}x${shoreCss.h}|${shore.alpha}|${shore.transforms.join(";")}|${mark}` : "";
    if (key === shoreKey) {
      return;
    }
    shoreKey = key;
    const existing = defs.querySelector(`#${shoreId}`);
    if (!shore) {
      existing?.remove();
      return;
    }
    const mask = (existing as SVGMaskElement | null) ?? element<SVGMaskElement>("mask");
    mask.id = shoreId;
    mask.setAttribute("maskUnits", "userSpaceOnUse");
    mask.setAttribute("maskContentUnits", "userSpaceOnUse");
    mask.setAttribute("mask-type", "luminance");
    mask.setAttribute("x", "0");
    mask.setAttribute("y", "0");
    mask.setAttribute("width", String(shoreCss.w));
    mask.setAttribute("height", String(shoreCss.h));
    mask.replaceChildren();
    const rect = element<SVGRectElement>("rect");
    rect.setAttribute("x", "0");
    rect.setAttribute("y", "0");
    rect.setAttribute("width", String(shoreCss.w));
    rect.setAttribute("height", String(shoreCss.h));
    rect.setAttribute("fill", "#ffffff");
    mask.append(rect);
    const gray = Math.round(Math.min(1, Math.max(0, shore.alpha)) * 255);
    const fill = `rgb(${gray},${gray},${gray})`;
    for (const transform of shore.transforms) {
      const wrap = element<SVGGElement>("g");
      wrap.setAttribute("transform", transform);
      const path = element<SVGPathElement>("path");
      path.setAttribute("d", shore.path);
      path.setAttribute("fill", fill);
      wrap.append(path);
      mask.append(wrap);
    }
    if (!existing) {
      defs.append(mask);
    }
  };

  const applyLight = (light: UnitSkyLight | null) => {
    const next = light?.key ?? "";
    const filter = defs.querySelector(`#${filterId}`);
    if (next === lightKey && (next === "" || filter)) {
      return;
    }
    lightKey = next;
    if (!light) {
      camera.removeAttribute("filter");
      return;
    }
    let node = filter as SVGFilterElement | null;
    if (!node) {
      node = element<SVGFilterElement>("filter");
      node.id = filterId;
      node.setAttribute("color-interpolation-filters", "sRGB");
      const matrix = element<SVGFEColorMatrixElement>("feColorMatrix");
      matrix.setAttribute("type", "matrix");
      node.append(matrix);
      defs.append(node);
    }
    const [red, green, blue] = light.ambient;
    node
      .querySelector("feColorMatrix")
      ?.setAttribute(
        "values",
        `${red / 255} 0 0 0 0  0 ${green / 255} 0 0 0  0 0 ${blue / 255} 0 0  0 0 0 1 0`,
      );
    camera.setAttribute("filter", `url(#${filterId})`);
  };

  const dropMasks = (id: string) => {
    for (const mask of [...defs.querySelectorAll("mask")]) {
      if (mask.id.startsWith(`veh-${id}-`)) {
        mask.remove();
      }
    }
  };

  const build = (unit: VehicleSvgUnit): UnitNode => {
    dropMasks(unit.id);
    const veil = element<SVGGElement>("g");
    const group = element<SVGGElement>("g");
    const root = element<SVGGElement>("g");
    veil.append(group);
    group.append(root);
    const parts: SVGGElement[] = [];
    unit.parts.forEach((part, index) => {
      const layer = element<SVGGElement>("g");
      layer.setAttribute("data-role", part.role);
      const scale = element<SVGGElement>("g");
      scale.setAttribute("data-scale", "1");
      const image = element<SVGImageElement>("image");
      image.setAttribute("preserveAspectRatio", "none");
      scale.append(image);
      if (part.maskHref) {
        const mask = element<SVGMaskElement>("mask");
        mask.id = `veh-${unit.id}-${index}`;
        mask.setAttribute("maskUnits", "objectBoundingBox");
        mask.setAttribute("maskContentUnits", "objectBoundingBox");
        mask.setAttribute("x", "0");
        mask.setAttribute("y", "0");
        mask.setAttribute("width", "1");
        mask.setAttribute("height", "1");
        mask.setAttribute("mask-type", "luminance");
        const maskImage = element<SVGImageElement>("image");
        maskImage.setAttribute("preserveAspectRatio", "none");
        maskImage.setAttribute("x", "0");
        maskImage.setAttribute("y", "0");
        maskImage.setAttribute("width", "1");
        maskImage.setAttribute("height", "1");
        mask.append(maskImage);
        defs.append(mask);
        image.setAttribute("mask", `url(#${mask.id})`);
      }
      layer.append(scale);
      root.append(layer);
      parts.push(layer);
    });
    return { veil, group, root, signature: signatureOf(unit.parts), parts };
  };

  const paint = (node: UnitNode, unit: VehicleSvgUnit) => {
    const face = unit.face ?? 1;
    const turn = unit.turnDeg ?? 0;
    const mirror = face < 0 ? ` scale(${face} 1)` : "";
    const spin = turn !== 0 ? ` rotate(${turn})` : "";
    const lean = figureLean;
    if (unit.shoreFade) {
      node.veil.setAttribute("mask", `url(#${shoreId})`);
    } else {
      node.veil.removeAttribute("mask");
    }
    node.group.setAttribute(
      "transform",
      `translate(${unit.x} ${unit.y})${spin}${mirror} scale(${unit.unitScale} ${unit.unitScale * lean})`,
    );
    node.root.setAttribute("transform", `translate(${unit.rootX} ${unit.rootY})`);
    unit.parts.forEach((part, index) => {
      const layer = node.parts[index];
      if (!layer) {
        return;
      }
      layer.setAttribute("transform", affineTransform(part));
      if (part.opacity != null && part.opacity < 1) {
        layer.setAttribute("opacity", String(part.opacity));
      } else {
        layer.removeAttribute("opacity");
      }
      const scale = layer.querySelector("[data-scale]");
      // Resolution scale is folded into affineTransform; keep inner group identity.
      if (!(scale instanceof SVGGElement)) {
        return;
      }
      scale.setAttribute("transform", "");
      showPicture(scale, part.href, String(part.width * part.resolution), String(part.height * part.resolution));
      if (!part.maskHref) {
        return;
      }
      const mask = defs.querySelector(`#veh-${unit.id}-${index}`);
      const maskImage = mask?.querySelector("image");
      if (maskImage && maskImage.getAttribute("href") !== part.maskHref) {
        maskImage.setAttribute("href", part.maskHref);
      }
    });
  };

  return {
    sync(cameraState, list, light) {
      figureLean = cameraState.figureLean != null && cameraState.figureLean > 0 ? cameraState.figureLean : 1;
      const width = Math.max(1, cameraState.cssWidth);
      const height = Math.max(1, cameraState.cssHeight);
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(height));
      shoreCss = { w: width, h: height };
      applyShore();
      camera.setAttribute("transform", `translate(${cameraState.camX} ${cameraState.camY}) scale(${cameraState.viewScale})`);
      applyLight(light);
      const live = new Set(list.map((unit) => unit.id));
      for (const [id, node] of units) {
        if (live.has(id)) {
          continue;
        }
        node.veil.remove();
        dropMasks(id);
        units.delete(id);
      }
      for (const unit of list) {
        let node = units.get(unit.id);
        const signature = signatureOf(unit.parts);
        if (!node || node.signature !== signature) {
          node?.veil.remove();
          node = build(unit);
          units.set(unit.id, node);
        }
        paint(node, unit);
        if (node.veil.parentNode !== camera) {
          camera.appendChild(node.veil);
        }
      }
    },
    setShoreVeil(next) {
      shore = next && next.path && next.transforms.length > 0 ? next : null;
      applyShore();
    },
    clear() {
      units.clear();
      lightKey = "";
      shore = null;
      shoreKey = "";
      camera.removeAttribute("filter");
      camera.replaceChildren();
      defs.replaceChildren();
    },
  };
}
