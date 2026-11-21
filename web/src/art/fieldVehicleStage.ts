/** Camera, then the unit's scale, then one sprite pixel, then the traced picture. */

const SVG_NS = "http://www.w3.org/2000/svg";

export interface VehicleStageCamera {
  cssWidth: number;
  cssHeight: number;
  camX: number;
  camY: number;
  viewScale: number;
}

export interface VehicleSvgPart {
  role: "tracks" | "torso" | "head" | "weapon";
  href: string;
  maskHref?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  resolution: number;
}

export interface VehicleSvgUnit {
  id: number;
  x: number;
  y: number;
  unitScale: number;
  rootX: number;
  rootY: number;
  parts: VehicleSvgPart[];
}

interface UnitNode {
  group: SVGGElement;
  root: SVGGElement;
  signature: string;
  parts: SVGGElement[];
}

export interface VehicleStage {
  sync(camera: VehicleStageCamera, units: readonly VehicleSvgUnit[]): void;
  clear(): void;
}

function signatureOf(parts: readonly VehicleSvgPart[]): string {
  return parts.map((part) => `${part.role}|${part.resolution}|${part.width}|${part.height}|${part.maskHref ? "m" : "o"}`).join(";");
}

function element<T extends SVGElement>(name: string): T {
  return document.createElementNS(SVG_NS, name) as T;
}

export function createVehicleStage(svg: SVGSVGElement): VehicleStage {
  svg.setAttribute("preserveAspectRatio", "none");
  svg.style.pointerEvents = "none";
  svg.style.overflow = "visible";
  const defs = element<SVGDefsElement>("defs");
  const camera = element<SVGGElement>("g");
  svg.replaceChildren(defs, camera);
  const units = new Map<number, UnitNode>();

  const dropMasks = (id: number) => {
    for (const mask of [...defs.querySelectorAll("mask")]) {
      if (mask.id.startsWith(`veh-${id}-`)) {
        mask.remove();
      }
    }
  };

  const build = (unit: VehicleSvgUnit): UnitNode => {
    dropMasks(unit.id);
    const group = element<SVGGElement>("g");
    const root = element<SVGGElement>("g");
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
    return { group, root, signature: signatureOf(unit.parts), parts };
  };

  const paint = (node: UnitNode, unit: VehicleSvgUnit) => {
    node.group.setAttribute("transform", `translate(${unit.x} ${unit.y}) scale(${unit.unitScale})`);
    node.root.setAttribute("transform", `translate(${unit.rootX} ${unit.rootY})`);
    unit.parts.forEach((part, index) => {
      const layer = node.parts[index];
      if (!layer) {
        return;
      }
      layer.setAttribute("transform", `translate(${part.x} ${part.y})`);
      const scale = layer.querySelector("[data-scale]");
      scale?.setAttribute("transform", `scale(${part.resolution > 0 ? 1 / part.resolution : 1})`);
      const image = layer.querySelector("image");
      if (!image) {
        return;
      }
      const width = String(part.width * part.resolution);
      const height = String(part.height * part.resolution);
      if (image.getAttribute("href") !== part.href) {
        image.setAttribute("href", part.href);
      }
      image.setAttribute("width", width);
      image.setAttribute("height", height);
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
    sync(cameraState, list) {
      const width = Math.max(1, cameraState.cssWidth);
      const height = Math.max(1, cameraState.cssHeight);
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(height));
      camera.setAttribute("transform", `translate(${cameraState.camX} ${cameraState.camY}) scale(${cameraState.viewScale})`);
      const live = new Set(list.map((unit) => unit.id));
      for (const [id, node] of units) {
        if (live.has(id)) {
          continue;
        }
        node.group.remove();
        dropMasks(id);
        units.delete(id);
      }
      for (const unit of list) {
        let node = units.get(unit.id);
        const signature = signatureOf(unit.parts);
        if (!node || node.signature !== signature) {
          node?.group.remove();
          node = build(unit);
          units.set(unit.id, node);
        }
        paint(node, unit);
        camera.appendChild(node.group);
      }
    },
    clear() {
      units.clear();
      camera.replaceChildren();
      defs.replaceChildren();
    },
  };
}
