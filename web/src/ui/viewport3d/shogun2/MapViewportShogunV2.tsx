// The diorama's campaign on the Shogun ground. It takes the props MapView takes.
//
// MapView stays in charge of the camera, every gesture and pick, the counters, the upright sprites,
// the badges, and the arrows, the same as `MapViewport3D`. This board replaces only the ground: the
// natural terrain and the faction wash, instead of the baked faction palette. The Z menu still
// drives the camera, the figures, and the effects, and its Shogun fold drives the wash and the ink.
//
// Until the land has loaded and the first board frame is up, MapView draws its own 2D ground.
import { Canvas } from "@react-three/fiber";
import { Component, type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { BoardFrame, BoardLayer } from "../../map/boardLayer";
import { getBoardTune, subscribeBoardTune } from "../../map/boardTuneStore";
import { facilitiesOf, facilityAnchorOf, type Rect, type RegionShape, type Vec2 } from "../../map/geometry";
import { landMaskAt } from "../../map/landMask";
import { FACTION_TINT } from "../../map/mapStyle";
import { ownersSignature } from "../../map/mapBakeMath";
import { MapView, type MapViewProps } from "../../map/MapView";
import { clipperFor, pointInMultiPolygon, type MultiPolygon } from "../../map/regionClip";
import { battleScarDescriptors } from "../../map/terrainRelief";
import { effectiveUnitSlots, roughShape } from "../../map/unitSlots";
import { wrapWorldX } from "../../map/viewMath";
import { FACTION_PALETTE, resolveFaction, type FactionKey } from "../../theme/factionPalette";
import { type BattleScar, BoardScene, type BoardStore } from "../BoardScene";
import { coastMaskCanvas } from "../boardTextures";
import { planProps, townSites } from "../propPlan";
import type { BoardLook } from "../sun";
import { type OwnedShape } from "../shogun/borderLines";
import { SHOGUN } from "../shogun/shogunMaterials";
import { factionCanvas, frontCanvas, lineCanvas, terrainCanvas } from "../shogun/shogunSheets";

const WORLD_FALLBACK: Rect = { x: 0, y: 0, w: 800, h: 504 };
const FACTION_KEYS: readonly FactionKey[] = ["US", "UK", "GER", "JAP", "USSR", "NEUTRAL"];

/** If the WebGL canvas cannot start, the board layer steps aside and the 2D ground stays. */
class BoardBoundary extends Component<{ onError(): void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function useBoardLook(): BoardLook {
  const [look, setLook] = useState<BoardLook>("field");
  useEffect(() => {
    const campaign = document.querySelector(".campaign");
    if (!campaign) {
      return;
    }
    const read = () => setLook(campaign.getAttribute("data-look") === "dusk" ? "dusk" : "field");
    read();
    const observer = new MutationObserver(read);
    observer.observe(campaign, { attributes: true, attributeFilter: ["data-look"] });
    return () => observer.disconnect();
  }, []);
  return look;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) {
      return;
    }
    const read = () => setReduced(query.matches);
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, []);
  return reduced;
}

function colorKeyOf(): string {
  const colors = getBoardTune().colors;
  return FACTION_KEYS.map((key) => colors[key] ?? "").join("|");
}

/** A picked colour in the Z menu wins. Otherwise the faction's own colour, never the strip palette. */
function washOf(owner: string): string {
  const key = resolveFaction(owner);
  return getBoardTune().colors[key] ?? (key === "NEUTRAL" ? FACTION_TINT.NEUTRAL : FACTION_PALETTE[key].primary);
}

/** Sea colour for the water shader, with the natural ground kept where the land is, for the props. */
function seaSheet(bounds: Rect, landPath: Path2D, terrain: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = terrain.width;
  canvas.height = terrain.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return canvas;
  }
  ctx.fillStyle = SHOGUN.seaDeep;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  const sx = canvas.width / bounds.w;
  const sy = canvas.height / bounds.h;
  ctx.setTransform(sx, 0, 0, sy, -bounds.x * sx, -bounds.y * sy);
  ctx.clip(landPath);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(terrain, 0, 0);
  ctx.restore();
  return canvas;
}

export default function MapViewportShogunV2(props: MapViewProps) {
  const { geometry, land } = props;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const store = useRef<BoardStore>({ frame: null, paint: 0, invalidate: null }).current;
  const look = useBoardLook();
  const still = useReducedMotion();
  const bounds: Rect = land?.viewBox ?? WORLD_FALLBACK;
  const colorKey = useSyncExternalStore(subscribeBoardTune, colorKeyOf, () => "");

  const clipped = useMemo(() => (land ? clipperFor(land.polygons).clipAll(geometry.regions) : null), [land, geometry]);
  const owners = ownersSignature(geometry.regions, props.owners);
  const ownersRef = useRef(props.owners);
  ownersRef.current = props.owners;
  const reliefRef = useRef(props.relief);
  reliefRef.current = props.relief;
  const frontKey = (props.relief?.frontlines ?? []).map((segment) => `${segment.x1},${segment.y1},${segment.x2},${segment.y2}`).join("|");

  const sheets = useMemo(() => {
    if (!land || !clipped) {
      return null;
    }
    const shapes: ReadonlyMap<string, MultiPolygon> = clipped;
    const terrain = terrainCanvas(bounds, geometry.regions, shapes);
    const sea = seaSheet(bounds, land.masterLandPath, terrain);
    const faction = factionCanvas(bounds, geometry.regions, shapes, ownersRef.current, washOf);
    const owned = geometry.regions.flatMap((region): OwnedShape[] => {
      const shape = shapes.get(region.id);
      if (region.type !== "land" || !shape) {
        return [];
      }
      const key = resolveFaction(ownersRef.current[region.id]);
      return [{ owner: key === "NEUTRAL" ? "" : key, shape }];
    });
    return {
      sea,
      terrain,
      faction,
      lines: lineCanvas(bounds, land, owned),
      front: frontCanvas(bounds, land, reliefRef.current?.frontlines ?? []),
    };
  }, [land, bounds, geometry, clipped, owners, frontKey, colorKey]);

  const mask = useMemo(() => (land ? coastMaskCanvas(land, land.viewBox) : null), [land]);

  const slotsOf = (region: RegionShape): Vec2[] => effectiveUnitSlots(region, clipped?.get(region.id) ?? roughShape(region));

  const plan = useMemo(() => {
    if (!land) {
      return null;
    }
    const sheet = land.viewBox;
    const isLand = (p: Vec2) => landMaskAt(land, { x: wrapWorldX(p.x, sheet), y: p.y });
    const landRegions = geometry.regions.filter((region) => region.type === "land");
    const keepClear = landRegions.flatMap((region) => [region.anchor, facilityAnchorOf(region), ...slotsOf(region)]);
    const towns = townSites(
      landRegions.map((region) => {
        const shape = clipped?.get(region.id) ?? roughShape(region);
        const size = facilitiesOf(region).factory;
        return {
          id: region.id,
          ipc: region.ipc,
          factory: size === "major" ? 2 : size === "minor" ? 1 : 0,
          anchor: region.anchor,
          contains: (p: Vec2) => pointInMultiPolygon(p, shape),
        };
      }),
      isLand,
      keepClear,
    );
    return planProps({ bounds: sheet, isLand, keepClear, towns });
  }, [land, geometry, clipped]);

  const scarKey = (props.relief?.scars ?? []).map((scar) => `${scar.regionId}:${scar.ember ? 1 : 0}`).join("|");
  const scars = useMemo<BattleScar[]>(
    () =>
      (reliefRef.current?.scars ?? []).flatMap((scar) => {
        const region = geometry.regions.find((item) => item.id === scar.regionId);
        if (!region || region.type !== "land") {
          return [];
        }
        const marks = battleScarDescriptors(region.id, region.anchor, [region.anchor, ...slotsOf(region)], scar.ember)[0];
        return marks ? [{ craters: marks.craters, ember: scar.ember }] : [];
      }),
    [scarKey, geometry, clipped],
  );

  const drawable = land !== null && sheets !== null && mask !== null && plan !== null && !failed;

  useEffect(() => {
    if (!drawable) {
      setReady(false);
      return;
    }
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setReady(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [drawable]);

  const layer = useMemo(
    () => ({
      frame(frame: BoardFrame) {
        store.frame = frame;
        store.paint += 1;
        store.invalidate?.();
      },
      touch() {
        store.paint += 1;
        store.invalidate?.();
      },
    }),
    [store],
  );

  const node =
    land && sheets && mask && plan && !failed ? (
      <BoardBoundary onError={() => setFailed(true)}>
        <Canvas
          className="board-3d"
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
          flat
          frameloop={props.suspended ? "never" : "demand"}
          dpr={window.devicePixelRatio || 1}
          gl={{ antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "high-performance" }}
        >
          <BoardScene
            store={store}
            land={land.polygons}
            bounds={bounds}
            bake={sheets.sea}
            mask={mask}
            plan={plan}
            scars={scars}
            look={look}
            dim={props.menuBackdrop === true}
            still={still}
            shogun={sheets}
          />
        </Canvas>
      </BoardBoundary>
    ) : null;

  const board: BoardLayer = { node, active: ready && drawable, frame: layer.frame, touch: layer.touch, ownFront: true, seaBorders: true };
  return <MapView {...props} board={board} />;
}
