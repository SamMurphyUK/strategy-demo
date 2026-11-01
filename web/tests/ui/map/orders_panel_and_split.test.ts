// @vitest-environment jsdom
import { act, createElement, useRef, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { expect, it } from "vitest";
import type { GameState } from "../../../src/engine/model/game_state";
import { cancel_phase_order } from "../../../src/engine/movement/phase_orders";
import { GameSessionStub } from "../../../src/engine/session/game_session_stub";
import type { Dict } from "../../../src/engine/model/types";
import { finishUnitDrag } from "../../../src/ui/map/moveDrag";
import { PendingOrders } from "../../../src/ui/map/panels/PendingOrders";
import { SplitStackPopover } from "../../../src/ui/map/splitPopover";
import { moveUnitsPayload } from "../../../src/ui/map/stackMove";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface DomEl {
  textContent: string | null;
  className: string;
  value?: string;
  click(): void;
  remove(): void;
  getAttribute(name: string): string | null;
  querySelector(sel: string): DomEl | null;
  querySelectorAll(sel: string): ArrayLike<DomEl>;
}

function doc(): { createElement(tag: string): DomEl; body: { appendChild(node: unknown): void } } {
  return (globalThis as unknown as { document: ReturnType<typeof doc> }).document;
}

function boot(infantryOnA = 3): GameSessionStub {
  const session = new GameSessionStub();
  session.initializeFromMap(
    {
      version: 2,
      coord_space: "svg",
      turn_order: ["ger", "ussr", "uk", "jap", "usa"],
      regions: [
        territory("a", "land", ["b"]),
        territory("b", "land", ["a", "c"]),
        territory("c", "land", ["b"]),
        territory("s1", "sea", ["s2"]),
        territory("s2", "sea", ["s1"]),
      ],
      starting_units: [
        { region_id: "a", faction_id: "ger", unit_type_id: "infantry", count: infantryOnA },
        { region_id: "a", faction_id: "ger", unit_type_id: "tank", count: 1 },
        { region_id: "b", faction_id: "ger", unit_type_id: "infantry", count: 1 },
        { region_id: "s1", faction_id: "ger", unit_type_id: "transport", count: 1 },
      ],
    },
    1,
  );
  return session;
}

function territory(id: string, type: "land" | "sea", neighbors: string[]): Dict {
  return {
    polygon: [
      [0, 0],
      [1, 0],
      [0, 1],
    ],
    neighbors,
    metadata: {
      region_id: id,
      name: id,
      faction: "GER",
      ipc: type === "land" ? 1 : 0,
      type,
      victory: false,
      factory: false,
    },
  };
}

function enterCombatMove(session: GameSessionStub): void {
  const result = session.applyCommand({
    command_id: "to_combat_move",
    player_id: session.state.current_faction_id,
    type: "end_phase",
    payload: {},
  });
  expect(result.result_type).toBe("ok");
  expect(session.state.current_phase).toBe("combat_move");
}

function sendMove(
  session: GameSessionStub,
  commandId: string,
  from: string,
  entry: { unit_type_id: string; instance_id?: string },
  target: string,
  count: number,
): void {
  const result = session.applyCommand({
    command_id: commandId,
    player_id: session.state.current_faction_id,
    type: "move_units",
    payload: moveUnitsPayload(from, entry, target, count),
  });
  if (result.result_type !== "ok") {
    throw new Error(result.error?.message ?? "move_units was rejected");
  }
}

function stackCount(state: GameState, regionId: string, unitType: string): number {
  return (state.region_units[regionId] ?? [])
    .filter((entry) => entry.faction_id === "ger" && entry.unit_type_id === unitType && entry.instance_id === undefined)
    .reduce((sum, entry) => sum + entry.count, 0);
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

async function unmount(root: Root, container: DomEl): Promise<void> {
  await act(async () => {
    root.unmount();
  });
  container.remove();
}

function buttonNamed(root: DomEl, name: string): DomEl {
  const buttons = Array.from(root.querySelectorAll("button"));
  const found = buttons.find((button) => (button.textContent ?? "").trim() === name);
  if (!found) {
    const labels = buttons.map((button) => (button.textContent ?? "").trim()).join(", ");
    throw new Error(`No button named ${name}. Saw: ${labels}`);
  }
  return found;
}

function DropSurface(props: {
  session: GameSessionStub;
  from: string;
  unitType: string;
  target: string;
  max: number;
  title: string;
  onChosen(count: number): void;
}) {
  const [count, setCount] = useState<number | null>(null);
  const countRef = useRef(0);
  countRef.current = count ?? 0;
  const entry = { unit_type_id: props.unitType, faction_id: props.session.state.current_faction_id, count: props.max };

  const drop = () => {
    const legal = props.session.getLegalMoveDestinations(
      props.from,
      props.unitType,
      props.session.state.current_faction_id,
      "",
    );
    const result = finishUnitDrag(
      { regionId: props.from, max: props.max, count: props.max, adjusted: false, legal },
      props.target,
    );
    if (result.type === "commit") {
      sendMove(props.session, `drop_${props.unitType}`, props.from, entry, result.target, result.count);
      return;
    }
    if (result.type === "split") {
      setCount(result.count);
    }
  };

  return createElement(
    "div",
    null,
    createElement("button", { type: "button", onClick: drop }, "Drop stack"),
    count === null
      ? null
      : createElement(SplitStackPopover, {
          title: props.title,
          count,
          max: props.max,
          x: 24,
          y: 24,
          boundsW: 900,
          boundsH: 700,
          onCount: setCount,
          onConfirm: () => {
            const chosen = countRef.current;
            props.onChosen(chosen);
            setCount(null);
            sendMove(props.session, `split_${props.unitType}`, props.from, entry, props.target, chosen);
          },
          onCancel: () => setCount(null),
        }),
  );
}

function OrdersBox(props: { session: GameSessionStub; onCancelled(): void }) {
  const [, setTick] = useState(0);
  const game = {
    session: props.session,
    cancelPhaseOrder(orderId: string) {
      cancel_phase_order(props.session.state, orderId);
      setTick((n) => n + 1);
    },
  };
  return createElement(PendingOrders, { game: game as never, onCancelled: props.onCancelled });
}

it("commits a one-unit drop as move_units without opening the split popover", async () => {
  const session = boot();
  enterCombatMove(session);
  const chosen: number[] = [];
  const view = await render(
    createElement(DropSurface, {
      session,
      from: "a",
      unitType: "tank",
      target: "b",
      max: 1,
      title: "Tank",
      onChosen: (count) => chosen.push(count),
    }),
  );

  await act(async () => {
    buttonNamed(view.container, "Drop stack").click();
  });

  expect(view.container.querySelector("[role=dialog]")).toBeNull();
  expect(chosen).toEqual([]);
  expect(stackCount(session.state, "a", "tank")).toBe(0);
  expect(stackCount(session.state, "b", "tank")).toBe(1);
  expect(stackCount(session.state, "a", "infantry")).toBe(3);
  expect(session.state.phase_orders).toEqual([
    expect.objectContaining({ unitType: "tank", count: 1, fromRegionId: "a", toRegionId: "b" }),
  ]);
  await unmount(view.root, view.container);
});

it("opens the split popover for a larger stack and moves the chosen count", async () => {
  const session = boot(5);
  enterCombatMove(session);
  const chosen: number[] = [];
  const view = await render(
    createElement(DropSurface, {
      session,
      from: "a",
      unitType: "infantry",
      target: "b",
      max: 5,
      title: "Infantry",
      onChosen: (count) => chosen.push(count),
    }),
  );

  await act(async () => {
    buttonNamed(view.container, "Drop stack").click();
  });

  const dialog = view.container.querySelector("[role=dialog]");
  expect(dialog).not.toBeNull();
  expect(dialog?.getAttribute("aria-label")).toBe("Split Infantry");
  expect(dialog?.querySelector(".split-title")?.textContent).toBe("Infantry 5 of 5");
  expect(Array.from(dialog!.querySelectorAll("button")).map((button) => (button.textContent ?? "").trim())).toEqual([
    "1",
    "2",
    "Half",
    "All",
    "−",
    "+",
    "Confirm",
    "Cancel",
  ]);
  expect(session.state.phase_orders).toEqual([]);

  await act(async () => {
    buttonNamed(dialog!, "Half").click();
  });

  const open = view.container.querySelector("[role=dialog]");
  expect(open?.querySelector(".split-title")?.textContent).toBe("Infantry 3 of 5");
  expect(open?.querySelector("input")?.value).toBe("3");
  const pills = Array.from(open!.querySelectorAll(".split-pills button"));
  expect(pills.find((button) => (button.textContent ?? "").trim() === "Half")?.className).toBe("active");
  expect(pills.find((button) => (button.textContent ?? "").trim() === "2")?.className).toBe("");

  await act(async () => {
    buttonNamed(open!, "Confirm").click();
  });

  expect(view.container.querySelector("[role=dialog]")).toBeNull();
  expect(chosen).toEqual([3]);
  expect(stackCount(session.state, "a", "infantry")).toBe(2);
  expect(stackCount(session.state, "b", "infantry")).toBe(4);
  expect(session.state.phase_orders).toEqual([
    expect.objectContaining({ unitType: "infantry", count: 3, fromRegionId: "a", toRegionId: "b" }),
  ]);
  await unmount(view.root, view.container);
});

it("removes a pending order and restores the board when Cancel is clicked", async () => {
  const session = boot();
  enterCombatMove(session);
  sendMove(session, "mv_inf", "a", { unit_type_id: "infantry" }, "b", 1);
  sendMove(session, "mv_tank", "a", { unit_type_id: "tank" }, "c", 1);
  const infantryOrderId = session.state.phase_orders[0]?.id;
  expect(infantryOrderId).toBeTruthy();
  expect(stackCount(session.state, "a", "infantry")).toBe(2);
  expect(stackCount(session.state, "b", "infantry")).toBe(2);
  expect(stackCount(session.state, "c", "tank")).toBe(1);

  let cancelled = 0;
  const view = await render(createElement(OrdersBox, { session, onCancelled: () => (cancelled += 1) }));
  const text = view.container.textContent ?? "";
  expect(text).toContain("Pending orders");
  expect(text).toContain("2 orders");
  expect(text).toContain("Combat Move");
  expect(text).toContain("Germany");
  expect(text).toContain("1× Infantry");
  expect(text).toContain("a → b");
  expect(text).toContain("1× Tank");
  expect(text).toContain("a → c");
  const cancels = Array.from(view.container.querySelectorAll(".order-cancel"));
  expect(cancels.map((button) => (button.textContent ?? "").trim())).toEqual(["× Cancel", "× Cancel"]);

  const infantryCancel = cancels.find((button) => button.getAttribute("aria-label") === "Cancel 1× Infantry, a to b");
  expect(infantryCancel).toBeTruthy();
  await act(async () => {
    infantryCancel!.click();
  });

  expect(cancelled).toBe(1);
  expect(session.state.phase_orders.some((order) => order.unitType === "infantry")).toBe(false);
  expect(session.state.phase_orders).toEqual([
    expect.objectContaining({ unitType: "tank", count: 1, fromRegionId: "a", toRegionId: "c" }),
  ]);
  expect(stackCount(session.state, "a", "infantry")).toBe(3);
  expect(stackCount(session.state, "b", "infantry")).toBe(1);
  expect(stackCount(session.state, "a", "tank")).toBe(0);
  expect(stackCount(session.state, "c", "tank")).toBe(1);
  const after = view.container.textContent ?? "";
  expect(after).toContain("1 order");
  expect(after).toContain("1× Tank");
  expect(after).not.toContain("Infantry");
  expect(Array.from(view.container.querySelectorAll(".order-cancel")).map((button) => (button.textContent ?? "").trim())).toEqual([
    "× Cancel",
  ]);
  await unmount(view.root, view.container);
});
