// Headless port of the command and snapshot paths in scenes/game_scene.gd and
// scripts/region_inspector_panel.gd. No nodes: map selection, the inspector and the
// region stack list are plain view state the playground can render.
import type { Dict } from "../model/types";
import { GameSessionFactory, SessionMode } from "../session/game_session_factory";
import type { GameSessionStub } from "../session/game_session_stub";
import { godotCapitalize } from "./godot_string";

export const InspectorViewMode = { REGION: "region", COMBAT: "combat" } as const;
export type InspectorViewModeValue = (typeof InspectorViewMode)[keyof typeof InspectorViewMode];

const COLLAPSED_HEIGHT = 44.0;
const EXPANDED_HEIGHT = 176.0;

export class RegionInspectorState {
  visible = false;
  regionId = "";
  viewMode: InspectorViewModeValue = InspectorViewMode.REGION;
  viewerFaction = "";
  expanded = false;

  get collapsedVisible(): boolean {
    return !this.expanded;
  }

  get height(): number {
    if (!this.visible) {
      return 0;
    }
    return this.expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;
  }

  setViewerFaction(factionId: string): void {
    this.viewerFaction = factionId.toLowerCase();
  }

  showRegion(regionId: string): void {
    this.regionId = regionId;
    this.viewMode = InspectorViewMode.REGION;
    this.visible = regionId !== "";
  }

  showCombatInfo(regionId: string): void {
    this.regionId = regionId;
    this.viewMode = InspectorViewMode.COMBAT;
    this.visible = regionId !== "";
    this.expanded = true;
  }

  setRegionView(regionId: string): void {
    this.showRegion(regionId);
  }

  refresh(): void {
    if (this.regionId === "") {
      this.visible = false;
    }
  }

  clearSelection(): void {
    this.regionId = "";
    this.viewMode = InspectorViewMode.REGION;
    this.visible = false;
  }
}

export class MapSelection {
  selectedRegionId = "";

  constructor(private readonly onRegionSelected: (regionId: string) => void) {}

  selectRegion(regionId: string): void {
    this.selectedRegionId = regionId;
    this.onRegionSelected(regionId);
  }
}

export class GameSceneController {
  readonly session: GameSessionStub;
  readonly mapRoot: MapSelection;
  readonly regionInspectorPanel = new RegionInspectorState();
  regionStackRows: string[] = [];
  uiPendingPurchases: Record<string, number> = {};
  readonly log: string[] = [];
  private commandCounter = 0;

  constructor(session: GameSessionStub = GameSessionFactory.create(SessionMode.STUB)) {
    this.session = session;
    this.mapRoot = new MapSelection((regionId) => this.onRegionSelected(regionId));
    this.refreshAll();
  }

  onCatalogBuy(unitTypeId: string, count = 1): void {
    if (this.currentPhase() !== "purchase") {
      this.logSystem("Purchases only allowed in purchase phase.");
      return;
    }
    this.uiPendingPurchases[unitTypeId] = (this.uiPendingPurchases[unitTypeId] ?? 0) + count;
  }

  onPurchaseConfirmPressed(): void {
    const purchases: Dict[] = [];
    for (const unitTypeId of Object.keys(this.uiPendingPurchases)) {
      const c = this.uiPendingPurchases[unitTypeId];
      if (c > 0) {
        purchases.push({ unit_type_id: unitTypeId, count: c });
      }
    }
    if (purchases.length === 0) {
      this.logSystem("No pending purchases to confirm.");
      return;
    }
    const result = this.session.applyCommand({
      command_id: this.nextCommandId(),
      player_id: this.selectedFactionId(),
      type: "purchase_units",
      payload: { purchases },
    });
    if (result.result_type === "ok") {
      this.uiPendingPurchases = {};
      this.refreshAll();
    } else {
      this.logSystem(`Purchase failed [${result.error?.code ?? "UNKNOWN"}]: ${result.error?.message ?? ""}`);
    }
  }

  onCancelPurchasePressed(): void {
    this.uiPendingPurchases = {};
  }

  onSpawnInfantryPressed(): void {
    const phase = this.currentPhase();
    if (phase === "purchase") {
      this.onCatalogBuy("infantry", 1);
      return;
    }
    if (phase === "mobilize") {
      const regionId = this.mapRoot.selectedRegionId;
      if (regionId === "") {
        this.logSystem("Select a region before placing units.");
        return;
      }
      this.applyCommand("place_units", {
        placements: [{ region_id: regionId, units: [{ unit_type_id: "infantry", count: 1 }] }],
      });
      return;
    }
    this.logSystem(`Spawn only works in purchase or mobilize. Phase: ${phase}`);
  }

  onEndPhasePressed(): void {
    this.applyCommand("end_phase", {});
  }

  onEndTurnPressed(): void {
    this.applyCommand("end_turn", {});
  }

  onRegionSelected(regionId: string): void {
    this.regionInspectorPanel.setRegionView(regionId);
    this.refreshRegionStack(regionId);
    this.refreshRegionInspector();
    this.logSystem(`Selected region: ${regionId}`);
  }

  private applyCommand(typeName: string, payload: Dict): void {
    const result = this.session.applyCommand({
      command_id: this.nextCommandId(),
      player_id: this.commandPlayerId(),
      type: typeName,
      payload,
    });
    if (result.result_type !== "ok") {
      this.logSystem(`Command failed [${result.error?.code ?? "UNKNOWN"}]: ${result.error?.message ?? ""}`);
    }
    this.refreshAll();
  }

  private refreshAll(): void {
    this.refreshRegionStack(this.mapRoot.selectedRegionId);
    this.refreshRegionInspector();
  }

  private refreshRegionInspector(): void {
    const panel = this.regionInspectorPanel;
    panel.setViewerFaction(this.commandPlayerId());
    const regionId = this.mapRoot.selectedRegionId;
    if (regionId === "") {
      panel.clearSelection();
      return;
    }
    if (panel.viewMode === InspectorViewMode.COMBAT) {
      panel.showCombatInfo(regionId);
    } else {
      panel.showRegion(regionId);
    }
    panel.refresh();
  }

  /** Fallback list from _refresh_region_stack: a header, then one row per faction and unit type. */
  private refreshRegionStack(selectedRegionId: string): void {
    const rows = ["Region Stack"];
    if (selectedRegionId === "") {
      rows.push("Select a region.");
      this.regionStackRows = rows;
      return;
    }
    const snapshot = this.session.getState();
    for (const regionEntry of snapshot.regions) {
      if (regionEntry.region_id !== selectedRegionId) {
        continue;
      }
      const grouped: Record<string, Record<string, number>> = { allies: {}, axis: {}, neutral: {} };
      for (const u of regionEntry.units) {
        const faction = String(u.faction_id ?? "neutral").toLowerCase();
        grouped[faction] ??= {};
        const unitTypeId = String(u.unit_type_id ?? "");
        grouped[faction][unitTypeId] = (grouped[faction][unitTypeId] ?? 0) + Math.trunc(Number(u.count ?? 0));
      }
      for (const faction of Object.keys(grouped)) {
        for (const unitTypeId of Object.keys(grouped[faction])) {
          rows.push(`${godotCapitalize(faction)}: ${unitTypeId} x${grouped[faction][unitTypeId]}`);
        }
      }
      break;
    }
    this.regionStackRows = rows;
  }

  private selectedFactionId(): string {
    return "allies";
  }

  private commandPlayerId(): string {
    const active = String(this.session.state.current_faction_id);
    return active !== "" ? active : this.selectedFactionId();
  }

  private currentPhase(): string {
    return String(this.session.state.current_phase);
  }

  private nextCommandId(): string {
    this.commandCounter += 1;
    return `gsc_${String(this.commandCounter).padStart(4, "0")}`;
  }

  private logSystem(message: string): void {
    this.log.push(message);
  }
}
