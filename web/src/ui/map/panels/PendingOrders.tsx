import type { CSSProperties } from "react";
import { soundManager } from "../../../audio/sound_manager";
import type { MoveOrder } from "../../../engine/movement/phase_orders";
import { factionPalette } from "../../theme/factionPalette";
import { factionName, unitName } from "../session/event_text";
import type { GameSessionHandle } from "../session/use_game_session";

const MOVEMENT_PHASES = ["combat_move", "noncombat_move"];

function factionStyle(factionId: string): CSSProperties {
  const palette = factionPalette(factionId);
  return { "--faction": palette.primary, "--faction-ring": palette.ring } as CSSProperties;
}

export function movementOrderLabel(phase: string): string {
  if (phase === "combat_move") {
    return "Combat Move";
  }
  if (phase === "noncombat_move") {
    return "Non-Combat Move";
  }
  return "";
}

function regionLabel(game: GameSessionHandle, regionId: string): string {
  const region = game.session.state.regions[regionId];
  const name = region?.name?.trim();
  return name ? name : regionId;
}

interface Props {
  game: GameSessionHandle;
  onCancelled(): void;
}

export function PendingOrders({ game, onCancelled }: Props) {
  const state = game.session.state;
  const phase = state.current_phase;
  const orders = state.phase_orders;
  const kind = movementOrderLabel(phase);
  if (!MOVEMENT_PHASES.includes(phase) || orders.length === 0 || kind === "") {
    return null;
  }

  const cancel = (order: MoveOrder) => {
    soundManager.play("order_cancel");
    game.cancelPhaseOrder(order.id);
    onCancelled();
  };

  return (
    <section className="pending-orders" aria-label="Pending orders">
      <div className="pending-orders-head">
        <h2>Pending orders</h2>
        <span className="pending-orders-count">{orders.length === 1 ? "1 order" : `${orders.length} orders`}</span>
      </div>
      <ul>
        {orders.map((order) => {
          const unit = unitName(order.unitType, state.unit_types);
          const from = regionLabel(game, order.fromRegionId);
          const to = regionLabel(game, order.toRegionId);
          return (
            <li key={order.id} className="pending-order">
              <span className="faction-chip" style={factionStyle(order.faction)}>
                {factionName(order.faction)}
              </span>
              <span className="order-kind">{kind}</span>
              <span className="order-units">
                {order.count}× {unit}
              </span>
              <span className="order-route">
                {from} → {to}
              </span>
              <button
                type="button"
                className="order-cancel"
                onClick={() => cancel(order)}
                aria-label={`Cancel ${order.count}× ${unit}, ${from} to ${to}`}
              >
                × Cancel
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
