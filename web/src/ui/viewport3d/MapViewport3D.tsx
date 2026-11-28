// The campaign board with a React Three Fiber ground under it. It takes the props MapView takes, so
// the campaign screen can mount either one.
//
// MapView stays in charge of the campaign: the camera, every gesture and pick, the counters, the
// upright sprites, the badges, and the arrows. This component hands it a board layer (see
// boardLayer.ts). The layer draws the water, the land and its cliffs, the trees, peaks, and roofs,
// the shadows, and the smoke in WebGL, then lays MapView's canvases over that picture and finishes
// the frame with the grade, the miniature lens, and the vignette. So a drag, a drop, or an arrow on
// this board is the same code as on the 2D map, drawn over a different ground.
//
// Until the land has loaded and the first board frame is up, and whenever WebGL is not to be had,
// MapView draws its own 2D ground and nothing is lost.
import { Canvas } from "@react-three/fiber";
import { Component, type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { BoardFrame, BoardLayer } from "../map/boardLayer";
import { landColor } from "../map/boardTune";
import { getBoardTune } from "../map/boardTuneStore";
import { facilitiesOf, airAnchorOf, facilityAnchorOf, type Rect, type RegionShape, type Vec2 } from "../map/geometry";
import { buildRegionPaths } from "../map/hitTest";
import { landMaskAt } from "../map/landMask";
import { bakeTerrain } from "../map/mapBake";
import { ownersSignature } from "../map/mapBakeMath";
import { mapVisuals, subscribeVisuals } from "../map/mapVisualConfig";
import { MapView, type MapViewProps } from "../map/MapView";
import { clipperFor, type MultiPolygon, pointInMultiPolygon } from "../map/regionClip";
import { battleScarDescriptors, craterCountFor } from "../map/terrainRelief";
import { effectiveUnitSlots, roughShape } from "../map/unitSlots";
import { clearFacilityTargets, setFacilityTarget } from "../map/facilityTargets";
import { wrapWorldX } from "../map/viewMath";
import { type BattleScar, type BoardPixie, BoardScene, type BoardStore, type BoardTable } from "./BoardScene";
import { PlacementButton, PlacementEditor } from "./PlacementEditor";
import savedPlacements from "./placements.json";
import {
  applyPlacements,
  facilityKindOf,
  parsePlacements,
  PLACEMENTS_STORAGE_KEY,
  type Placements,
  placeFacilities,
  placeLandmarks,
  serializePlacements,
} from "./placements";
import { BOARD_BAKE_SCALE, coastMaskCanvas } from "./boardTextures";
import { planRoads, riverLines } from "./groundSheet";
import { biomeAtMap } from "./geography";
import { airbaseSite, type FacilitySite, harborSite } from "./facilitySites";
import { islandCells } from "./islandLowering";
import { monsoonSites } from "./mistPlacement";
import { SEA_DROP } from "./boardCamera";
import { buildHillPatch, HILL_PEAK, buildReliefPatch, RELIEF_ZONES, sampleReliefFields } from "./mountainRelief";
import { buildCoastField } from "./pixieSheet";
import { climateZoneCanvas, regionIdCanvas } from "./pixieTextures";
import { planProps, townSites } from "./propPlan";
import { factionCanvas } from "./shogun/shogunSheets";
import type { BoardLook } from "./sun";

const WORLD_FALLBACK: Rect = { x: 0, y: 0, w: 800, h: 504 };
/** The longest single road, in world units: about a seventh of the way round the board. */
const ROAD_REACH = 110;

/** The box round a shape. */
function boxOf(shape: MultiPolygon): Rect {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const polygon of shape) {
    for (const [x, y] of polygon[0] ?? []) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return x1 >= x0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 };
}

/** Whether the bases under land stacks are drawn by the board. */
function basesSwitch(): boolean {
  return mapVisuals.enable3DBases;
}

/** Whether the pixel chart is switched on. The one visual setting React is told about here. */
function chartSwitch(): boolean {
  return mapVisuals.enableFauxPixelMap;
}

function inBox(p: Vec2, box: Rect): boolean {
  return p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;
}

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

/** The campaign screen's look, read from the attribute the 2D map's CSS keys on. */
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

/** The draft the editor left in this browser, or the file saved in the project. */
function loadPlacements(): Placements {
  try {
    const draft = window.localStorage.getItem(PLACEMENTS_STORAGE_KEY);
    if (draft) {
      return parsePlacements(JSON.parse(draft));
    }
  } catch {
    // A bad draft is the same as none.
  }
  return parsePlacements(savedPlacements);
}

export default function MapViewport3D(props: MapViewProps) {
  const { geometry, land } = props;
  const [placements, setPlacements] = useState<Placements>(loadPlacements);
  const [editing, setEditing] = useState(false);
  const changePlacements = (next: Placements) => {
    setPlacements(next);
    try {
      window.localStorage.setItem(PLACEMENTS_STORAGE_KEY, JSON.stringify(serializePlacements(next)));
    } catch {
      // The draft is a convenience. Not keeping it costs nothing.
    }
  };
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const store = useRef<BoardStore>({ frame: null, paint: 0, invalidate: null }).current;
  const look = useBoardLook();
  const still = useReducedMotion();
  const bounds: Rect = land?.viewBox ?? WORLD_FALLBACK;

  // The same true shapes MapView clips. The clipper caches by cutter, so this costs a lookup.
  const clipped = useMemo(() => (land ? clipperFor(land.polygons).clipAll(geometry.regions) : null), [land, geometry]);
  const paths = useMemo(() => buildRegionPaths(geometry.regions, clipped), [geometry, clipped]);
  const owners = ownersSignature(geometry.regions, props.owners);
  const ownersRef = useRef(props.owners);
  ownersRef.current = props.owners;

  // The base map, baked once at the board's resolution and again when a territory changes hands.
  // `owners` is the signature of the owner table, so a new table with the same owners bakes nothing.
  const bake = useMemo(
    () =>
      land
        ? bakeTerrain(
            { bounds: land.viewBox, land, regions: geometry.regions, paths, shapes: clipped, exact: clipped !== null, owners: ownersRef.current },
            BOARD_BAKE_SCALE,
          ).canvas
        : null,
    [land, geometry, paths, clipped, owners],
  );
  const mask = useMemo(() => (land ? coastMaskCanvas(land, land.viewBox) : null), [land]);

  // The pixel chart's sheets (see pixieSheet.ts), made once for a map and only while the chart is
  // switched on. The switch is the one setting this component reads: it is on or off, and the
  // chart's numbers go to the shaders without a render.
  const chartOn = useSyncExternalStore(subscribeVisuals, chartSwitch, chartSwitch);
  const bases3D = useSyncExternalStore(subscribeVisuals, basesSwitch, basesSwitch);
  const chartCoast = useMemo(
    () => (land && chartOn ? buildCoastField((p) => landMaskAt(land, p), land.viewBox) : null),
    [land, chartOn],
  );
  const chartIds = useMemo(() => (land && chartOn ? regionIdCanvas(land.viewBox, geometry.regions, paths) : null), [land, geometry, paths, chartOn]);
  const chartZones = useMemo(() => (land && chartOn ? climateZoneCanvas(land.viewBox, geometry.regions, paths) : null), [land, geometry, paths, chartOn]);
  // Whose land is whose, flat, in the colours the baked sheet uses. Painted again when a territory changes hands.
  const chartFaction = useMemo(() => {
    if (!land || !chartOn) {
      return null;
    }
    const shapes = clipped ?? new Map(geometry.regions.map((region) => [region.id, roughShape(region)] as const));
    return factionCanvas(land.viewBox, geometry.regions, shapes, ownersRef.current, (owner) => landColor(owner, getBoardTune()));
  }, [land, geometry, clipped, owners, chartOn]);
  const pixie = useMemo<BoardPixie | null>(
    () => (chartCoast && chartIds && chartZones && chartFaction ? { coast: chartCoast, ids: chartIds, zones: chartZones, faction: chartFaction } : null),
    [chartCoast, chartIds, chartZones, chartFaction],
  );

  const slotsOf = (region: RegionShape): Vec2[] => effectiveUnitSlots(region, clipped?.get(region.id) ?? roughShape(region));

  // Trees, peaks, and roofs, laid out clear of every point the pieces use.
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
    return planProps({ bounds: sheet, isLand, keepClear, towns, canopyContrast: mapVisuals.canopyBiomeContrast });
  }, [land, geometry, clipped]);

  // The plan with the editor's edits laid on it, and the landmarks where they stand.
  const placedPlan = useMemo(() => (plan ? applyPlacements(plan, placements) : null), [plan, placements]);
  const landmarks = useMemo(
    () =>
      placeLandmarks((name) => {
        const wanted = name.toLowerCase();
        const region = geometry.regions.find((item) => item.id.toLowerCase() === wanted);
        return region ? region.anchor : null;
      }, placements),
    [geometry, placements],
  );

  // The islands: polygons of the land small enough to be lowered, with the territories that stand on them.
  const islands = useMemo(() => (land ? islandCells(land.polygons, geometry.regions) : []), [land, geometry]);

  // The monsoon mist over the Southeast Asian jungles: dense ribbons spread over those territories' land.
  const monsoon = useMemo(() => {
    if (!land) {
      return [];
    }
    const sheet = land.viewBox;
    return monsoonSites(
      geometry.regions
        .filter((region) => region.type === "land")
        .map((region) => {
          const shape = clipped?.get(region.id) ?? roughShape(region);
          return { id: region.id, box: region.bounds, contains: (p: Vec2) => pointInMultiPolygon(p, shape) };
        }),
      (x, y) => landMaskAt(land, { x: wrapWorldX(x, sheet), y }),
    );
  }, [land, geometry, clipped]);

  // The harbors and airbases: those the map has, and those that have been built. A harbor stands at the foot of a cliff, an airbase on the
  // level ground by the air anchor. They are landmarks, so the placement editor moves them.
  const builtKey = (props.builtFacilities ?? []).map((item) => `${item.regionId}:${item.airbase ? 1 : 0}${item.harbor ? 1 : 0}`).join("|");
  const facilityMarks = useMemo(() => {
    if (!land) {
      return [];
    }
    const sheet = land.viewBox;
    const isLand = (p: Vec2) => landMaskAt(land, { x: wrapWorldX(p.x, sheet), y: p.y });
    const built = new Map((props.builtFacilities ?? []).map((item) => [item.regionId, item] as const));
    const sites: FacilitySite[] = [];
    for (const region of geometry.regions) {
      if (region.type !== "land") {
        continue;
      }
      const extra = built.get(region.id);
      const shape = clipped?.get(region.id) ?? roughShape(region);
      if (region.hasHarbour || extra?.harbor) {
        const site = harborSite(region.id, facilityAnchorOf(region), isLand, (p) => pointInMultiPolygon(p, shape)) ?? harborSite(region.id, region.anchor, isLand, (p) => pointInMultiPolygon(p, shape));
        if (site) {
          sites.push(site);
        }
      }
      if (region.hasAirbase || extra?.airbase) {
        sites.push(airbaseSite(region.id, airAnchorOf(region)));
      }
    }
    return placeFacilities(sites, placements, SEA_DROP * mapVisuals.terrainHeightScale - 0.12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [land, geometry, clipped, placements, builtKey]);
  const everyLandmark = useMemo(() => [...landmarks, ...facilityMarks], [landmarks, facilityMarks]);
  // The badge painter points each of a territory's facility badges at the model that replaces it as the camera comes in.
  useEffect(() => {
    clearFacilityTargets();
    for (const mark of facilityMarks) {
      const kind = facilityKindOf(mark.id);
      if (kind) {
        setFacilityTarget(mark.spec.region, kind === "harbor" ? "harbour" : "airbase", { x: mark.instance.x, y: mark.instance.y });
      }
    }
    // The factory's model stands at the territory's facility anchor.
    for (const region of geometry.regions) {
      if (region.type === "land" && facilitiesOf(region).factory !== "none") {
        setFacilityTarget(region.id, "factory", facilityAnchorOf(region));
      }
    }
    return clearFacilityTargets;
  }, [facilityMarks, geometry]);

  // The table under the pieces: the three sculpted ranges, the rivers, and the roads between the
  // capitals and the factories. Set dressing only, laid out once for a map.
  const table = useMemo<BoardTable | null>(() => {
    if (!land) {
      return null;
    }
    const sheet = land.viewBox;
    const isLand = (p: Vec2) => landMaskAt(land, { x: wrapWorldX(p.x, sheet), y: p.y });
    const lands = geometry.regions
      .filter((region) => region.type === "land")
      .map((region) => {
        const shape = clipped?.get(region.id) ?? roughShape(region);
        return { region, shape, box: boxOf(shape) };
      });
    const owner = (p: Vec2) => lands.find((item) => inBox(p, item.box) && pointInMultiPolygon(p, item.shape));
    const keepClear = lands.flatMap(({ region }) => [region.anchor, facilityAnchorOf(region), ...slotsOf(region)]);

    // A road runs from one town's roofs to the next, where the map gives a territory a town.
    const hubs = lands
      .filter(({ region }) => region.capital === true || facilitiesOf(region).factory !== "none")
      .map(({ region, shape }) => {
        const size = facilitiesOf(region).factory;
        const town = townSites(
          [
            {
              id: region.id,
              ipc: Math.max(region.ipc, 2),
              factory: size === "major" ? 2 : size === "minor" ? 1 : 0,
              anchor: region.anchor,
              contains: (p: Vec2) => pointInMultiPolygon(p, shape),
            },
          ],
          isLand,
          keepClear,
        )[0];
        return town ? { x: town.x, y: town.y } : { x: region.anchor.x, y: region.anchor.y };
      });
    const rivers = riverLines();
    // A road keeps to dry land and out of the ranges no territory owns. A point on the hairline
    // between two territories belongs to neither shape, and a road crosses there all the same.
    const inRange = (p: Vec2) => RELIEF_ZONES.some((zone) => zone.gap !== undefined && inBox(p, zone.gap.box)) && owner(p) === undefined;
    const roads = planRoads(hubs, (p) => isLand(p) && !inRange(p), { reach: ROAD_REACH });

    // A range leaves a valley for a river and a pass for a road.
    const valleys = [...rivers.flat(), ...roads.flat()];
    const patches = RELIEF_ZONES.flatMap((zone, index) => {
      if (zone.gap) {
        const patch = buildReliefPatch({
          box: zone.gap.box,
          inside: (p) => isLand(p) && owner(p) === undefined,
          seed: zone.gap.seed,
          // No piece stands on land no territory owns, and a summit is too low to hide one beside it.
          keepClear: [],
          valleys,
          rise: zone.rise,
          step: zone.step,
          salt: index * 37 + 11,
        });
        return patch ? [patch] : [];
      }
      const found = lands.find((item) => item.region.id === zone.region);
      if (!found) {
        return [];
      }
      const patch = buildReliefPatch({
        box: found.box,
        inside: (p) => pointInMultiPolygon(p, found.shape) && isLand(p),
        keepClear,
        valleys,
        rise: zone.rise,
        step: zone.step,
        salt: index * 37 + 11,
      });
      return patch ? [patch] : [];
    });
    // The broad hills lie over the land the ranges leave, from a coarse grid, and the tall ranges carry the spikes.
    const rangeTaken = (p: Vec2) => {
      const field = sampleReliefFields(patches, p.x, p.y);
      return field.dome > 0 || field.ridge > 0;
    };
    const hills = buildHillPatch({
      box: sheet,
      // The hills lie on the continents: an island is lowered, and a hill on it would float.
      inside: (p) => isLand(p) && !rangeTaken(p) && !islands.some((cell) => p.x >= cell.box.x0 && p.x <= cell.box.x1 && p.y >= cell.box.y0 && p.y <= cell.box.y1 && pointInMultiPolygon(p, [cell.polygon])),
      kind: (p) => {
        const biome = biomeAtMap(p);
        if (biome === "desert") {
          return { swell: 0.35, dune: 1 };
        }
        if (biome === "tundra" || biome === "ice") {
          return { swell: 0.5, dune: 0 };
        }
        if (biome === "steppe" || biome === "savanna" || biome === "scrub") {
          return { swell: 0.8, dune: 0.15 };
        }
        // Forest, taiga, jungle and the temperate lowlands: the fullest swell.
        return { swell: 1, dune: 0 };
      },
      step: 1.5,
      salt: 101,
    });
    if (hills) {
      hills.scale = mapVisuals.terrainHillRelief / HILL_PEAK;
      patches.push(hills);
    }
    return { patches, rivers, roads };
  }, [land, geometry, clipped, islands]);

  // Craters where the fighting is. The same marks the 2D map paints, so they sit in the same places.
  const scarKey = (props.relief?.scars ?? []).map((scar) => `${scar.regionId}:${scar.ember ? 1 : 0}:${craterCountFor(scar.attackers)}`).join("|");
  const reliefRef = useRef(props.relief);
  reliefRef.current = props.relief;
  const scars = useMemo<BattleScar[]>(
    () =>
      (reliefRef.current?.scars ?? []).flatMap((scar) => {
        const region = geometry.regions.find((item) => item.id === scar.regionId);
        if (!region || region.type !== "land") {
          return [];
        }
        const marks = battleScarDescriptors(
          region.id,
          region.anchor,
          [region.anchor, ...slotsOf(region)],
          scar.ember,
          // On the territory being fought over, and not across its border.
          (p) => pointInMultiPolygon(p, clipped?.get(region.id) ?? roughShape(region)),
          // The more units attack it, the more it is torn up.
          craterCountFor(scar.attackers),
        )[0];
        return marks ? [{ craters: marks.craters, ember: scar.ember }] : [];
      }),
    [scarKey, geometry, clipped],
  );

  const drawable = land !== null && bake !== null && mask !== null && plan !== null && !failed;

  // The board takes the ground two frames after it can draw, so its first picture is already up.
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
    land && bake && mask && plan && !failed ? (
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
          bake={bake}
          mask={mask}
          plan={placedPlan ?? plan}
          landmarks={everyLandmark}
          islands={islands}
          mistExtra={monsoon}
          scars={scars}
          look={look}
          dim={props.menuBackdrop === true}
          fighting={props.fighting}
          still={still}
          table={table}
          pixie={pixie}
        />
      </Canvas>
    </BoardBoundary>
  ) : null;

  const board: BoardLayer = { node, active: ready && drawable, frame: layer.frame, touch: layer.touch, groundLift: (world, stack) => store.lift?.(world, stack) ?? 0, plinths3D: bases3D && ready };
  return (
    <>
      <MapView {...props} board={board} />
      {!props.menuBackdrop && ready ? <PlacementButton open={editing} onToggle={() => setEditing((on) => !on)} /> : null}
      {editing && plan ? (
        <PlacementEditor
          frame={() => store.frame}
          surface={() => document.querySelector<HTMLElement>("canvas.map-canvas")}
          plan={placedPlan ?? plan}
          landmarks={landmarks}
          placements={placements}
          onChange={changePlacements}
          onRevert={() => {
            try {
              window.localStorage.removeItem(PLACEMENTS_STORAGE_KEY);
            } catch {
              // Nothing was kept.
            }
            setPlacements(parsePlacements(savedPlacements));
          }}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </>
  );
}
