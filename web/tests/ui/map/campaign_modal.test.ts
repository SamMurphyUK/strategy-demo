// @vitest-environment jsdom
import { act, createElement, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { DEFAULT_LEGACY_RULESET, SCENARIO_PRESETS } from "../../../src/engine/types/ruleset";
import { NewCampaignModal, type CampaignDraft } from "../../../src/ui/map/menu/NewCampaignModal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface DomEl {
  textContent: string | null;
  click(): void;
  querySelector(sel: string): DomEl | null;
  querySelectorAll(sel: string): ArrayLike<DomEl & { checked?: boolean; disabled?: boolean; value?: string }>;
}

function doc(): { createElement(tag: string): DomEl; body: { appendChild(node: unknown): void } } {
  return (globalThis as unknown as { document: ReturnType<typeof doc> }).document;
}

async function render(node: ReactElement): Promise<{ root: Root; container: DomEl }> {
  const container = doc().createElement("div");
  doc().body.appendChild(container);
  const root = createRoot(container as never);
  await act(async () => {
    root.render(node);
  });
  return { root, container };
}

function ModalHarness({ onSeen }: { onSeen(draft: CampaignDraft): void }) {
  const [draft, setDraft] = useState<CampaignDraft>({
    scenarioId: "SCENARIO_1942_QUICK",
    ruleset: { ...DEFAULT_LEGACY_RULESET },
    mapId: "demo",
    seed: "1",
  });
  const update = (next: CampaignDraft) => {
    onSeen(next);
    setDraft(next);
  };
  return createElement(NewCampaignModal, {
    draft,
    versions: [],
    playerFaction: "ger",
    onDraft: update,
    onPlayerFaction: () => undefined,
    onImportMap: () => "",
    onStart: () => undefined,
    onClose: () => undefined,
  });
}

describe("New campaign modal", () => {
  it("applies a scenario preset, a toggle, and classic vanilla", async () => {
    let latest: CampaignDraft | null = null;
    const { root, container } = await render(createElement(ModalHarness, { onSeen: (draft) => { latest = draft; } }));
    const radios = Array.from(container.querySelectorAll('input[type="radio"]'));
    expect(radios).toHaveLength(2);
    await act(async () => {
      radios[1].click();
    });
    expect(latest?.scenarioId).toBe("SCENARIO_GLOBAL_1940");
    expect(latest?.ruleset).toEqual(SCENARIO_PRESETS.SCENARIO_GLOBAL_1940);

    const boxes = Array.from(container.querySelectorAll('input[type="checkbox"]'));
    const research = boxes[boxes.length - 1];
    expect(research.checked).toBe(false);
    await act(async () => {
      research.click();
    });
    expect(latest?.ruleset.techTree).toBe(true);
    expect(latest?.ruleset.terrainModifiers).toBe(true);

    const buttons = Array.from(container.querySelectorAll("button"));
    const vanilla = buttons.find((button) => (button.textContent ?? "").includes("Classic Vanilla"));
    expect(vanilla).toBeTruthy();
    await act(async () => {
      vanilla?.click();
    });
    expect(latest?.ruleset).toEqual(DEFAULT_LEGACY_RULESET);

    const terrain = Array.from(container.querySelectorAll('input[type="checkbox"]'))[0];
    const bombardment = Array.from(container.querySelectorAll('input[type="checkbox"]'))[1];
    expect(bombardment.disabled).toBe(true);
    await act(async () => {
      terrain.click();
    });
    expect(latest?.ruleset.terrainModifiers).toBe(true);
    const openBombardment = Array.from(container.querySelectorAll('input[type="checkbox"]'))[1];
    expect(openBombardment.disabled).toBe(false);
    await act(async () => {
      openBombardment.click();
    });
    expect(latest?.ruleset.preparatoryBombardment).toBe(true);
    await act(async () => {
      Array.from(container.querySelectorAll('input[type="checkbox"]'))[0].click();
    });
    expect(latest?.ruleset.terrainModifiers).toBe(false);
    expect(latest?.ruleset.preparatoryBombardment).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });
});
