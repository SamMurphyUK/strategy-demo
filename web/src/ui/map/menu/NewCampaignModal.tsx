import { useState } from "react";
import type { Dict } from "../../../engine/model/types";
import { isDict } from "../../../engine/model/types";
import {
  applyRuleToggle,
  DEFAULT_LEGACY_RULESET,
  launchForScenario,
  RULE_TOGGLES,
  SCENARIO_LABEL,
  type CampaignLaunchConfig,
  type OptionalRulesetConfig,
  type ScenarioId,
} from "../../../engine/types/ruleset";
import type { MapVersion } from "../editor/mapVersions";
import { factionName } from "../session/event_text";
import { demoPlayChoice, playChoiceFromVersion, type PlayChoice } from "../session/play_map";

const POWERS = ["ussr", "ger", "uk", "jap", "usa"] as const;

const SCENARIO_CARDS: Record<ScenarioId, { title: string; detail: string }> = {
  SCENARIO_1942_QUICK: {
    title: "1942 Quick Campaign",
    detail: "Classic rules default.",
  },
  SCENARIO_GLOBAL_1940: {
    title: "1940 Global Grand Campaign",
    detail: "7 factions, Mobilization curves, China Guerrillas, Tactical rules default.",
  },
};

export interface CampaignDraft {
  scenarioId: ScenarioId;
  ruleset: OptionalRulesetConfig;
  mapId: string;
  seed: string;
}

export function draftLaunch(draft: CampaignDraft): CampaignLaunchConfig {
  return { scenarioId: draft.scenarioId, ruleset: { ...draft.ruleset } };
}

export function RuleBadges({ launch }: { launch: CampaignLaunchConfig }) {
  const active = RULE_TOGGLES.filter((rule) => launch.ruleset[rule.key]);
  return (
    <ul className="rule-badges" aria-label="Active rules">
      <li>{SCENARIO_CARDS[launch.scenarioId]?.title ?? SCENARIO_LABEL[launch.scenarioId]}</li>
      {active.length === 0 ? <li>Classic vanilla</li> : active.map((rule) => <li key={rule.key}>{rule.label}</li>)}
    </ul>
  );
}

export function NewCampaignModal({
  draft,
  versions,
  playerFaction,
  onDraft,
  onPlayerFaction,
  onImportMap,
  onStart,
  onClose,
}: {
  draft: CampaignDraft;
  versions: MapVersion[];
  playerFaction: string;
  onDraft(next: CampaignDraft): void;
  onPlayerFaction(factionId: string): void;
  onImportMap(name: string, map: Dict): string;
  onStart(choice: PlayChoice, seed: number, launch: CampaignLaunchConfig): void;
  onClose(): void;
}) {
  const [note, setNote] = useState("");
  const { scenarioId, ruleset } = draft;

  const chooseScenario = (next: ScenarioId) => {
    onDraft({ ...draft, scenarioId: next, ruleset: launchForScenario(next).ruleset });
  };

  const readMapFile = (file: File | undefined) => {
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed: unknown = JSON.parse(String(reader.result ?? ""));
        if (!isDict(parsed)) {
          setNote("That file is not a map.");
          return;
        }
        const name = file.name.replace(/\.json$/i, "") || "Imported map";
        const error = onImportMap(name, parsed);
        setNote(error === "" ? `Imported ${name}. Pick it under Map.` : error);
      } catch {
        setNote("That file is not map JSON.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="campaign-modal-scrim">
      <form
        className="campaign-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-campaign-title"
        onSubmit={(event) => {
          event.preventDefault();
          const n = Math.trunc(Number(draft.seed));
          const version = versions.find((item) => item.id === draft.mapId);
          onStart(
            version ? playChoiceFromVersion(version) : demoPlayChoice(),
            Number.isFinite(n) ? n : 12345,
            draftLaunch(draft),
          );
        }}
      >
        <h2 id="new-campaign-title">New campaign</h2>
        <fieldset className="scenario-cards">
          <legend>Scenario</legend>
          {(Object.keys(SCENARIO_CARDS) as ScenarioId[]).map((id) => (
            <label key={id} className={scenarioId === id ? "scenario-card selected" : "scenario-card"}>
              <input
                type="radio"
                name="campaign-scenario"
                value={id}
                checked={scenarioId === id}
                onChange={() => chooseScenario(id)}
              />
              <strong>{SCENARIO_CARDS[id].title}</strong>
              <span className="muted">{SCENARIO_CARDS[id].detail}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="main-menu-rules">
          <legend>Optional rules</legend>
          {RULE_TOGGLES.map((rule) => (
            <label key={rule.key}>
              <input
                type="checkbox"
                checked={ruleset[rule.key]}
                disabled={rule.key === "preparatoryBombardment" && !ruleset.terrainModifiers}
                onChange={(event) =>
                  onDraft({ ...draft, ruleset: applyRuleToggle(ruleset, rule.key, event.target.checked) })
                }
              />
              {rule.label}
              <span className="muted">{rule.detail}</span>
            </label>
          ))}
        </fieldset>
        <div className="campaign-modal-actions">
          <button type="button" onClick={() => onDraft({ ...draft, ruleset: launchForScenario(scenarioId).ruleset })}>
            Reset to Scenario Defaults
          </button>
          <button type="button" onClick={() => onDraft({ ...draft, ruleset: { ...DEFAULT_LEGACY_RULESET } })}>
            Classic Vanilla (All Off)
          </button>
        </div>
        <label>
          Map
          <select aria-label="Map" value={draft.mapId} onChange={(event) => onDraft({ ...draft, mapId: event.target.value })}>
            <option value="demo">Demo map</option>
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.name}
              </option>
            ))}
          </select>
        </label>
        <label className="editor-start-file">
          Custom map JSON
          <input type="file" accept="application/json,.json" aria-label="Custom map JSON" onChange={(event) => readMapFile(event.target.files?.[0])} />
        </label>
        <label>
          Your power
          <select aria-label="Your power" value={playerFaction} onChange={(event) => onPlayerFaction(event.target.value)}>
            {POWERS.map((faction) => (
              <option key={faction} value={faction}>
                {factionName(faction)}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">Hot-seat. Every power still takes its turn. This marks the one you are playing.</p>
        <label>
          Seed
          <input aria-label="Seed" value={draft.seed} onChange={(event) => onDraft({ ...draft, seed: event.target.value })} />
        </label>
        {note !== "" && <p className="warn">{note}</p>}
        <div className="campaign-modal-actions">
          <button type="submit" className="primary">
            Start Campaign
          </button>
          <button type="button" onClick={onClose}>
            Back
          </button>
        </div>
      </form>
    </div>
  );
}
