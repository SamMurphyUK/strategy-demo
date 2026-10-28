export { AmphibiousEngine } from "./amphibious/amphibious";
export { CarrierConstraintChecker } from "./air/carrier_constraint_checker";
export { PlaneLandingRequirement } from "./air/plane_landing_requirement";
export { type Battle, CombatEngine, MAX_BATTLE_ROUNDS } from "./combat/combat";
export { ContentLoader } from "./content/content_loader";
export { type JsonLoader, loadJson } from "./content/res";
export { UnitDatabase } from "./content/unit_database";
export { EconomyEngine } from "./economy/economy";
export { Command, CommandType, type CommandTypeValue } from "./model/command";
export { GameEvent, type GameEventDict, GameEventType, type GameEventTypeValue } from "./model/event";
export { Faction } from "./model/faction";
export { GameState, type RegionSnapshot, type StateSnapshot, type TurnInfo } from "./model/game_state";
export { Region, type RegionType } from "./model/region";
export type { CargoLine, Dict, PurchaseLine, TransportInstance, UnitStackEntry } from "./model/types";
export { Unit, type UnitType } from "./model/unit";
export { MovementEngine } from "./movement/movement";
export { MovementValidator } from "./movement/movement_validator";
export { PlacementEngine } from "./placement/placement";
export { PlacementValidator } from "./placement/placement_validator";
export { PurchaseValidator } from "./placement/purchase_validator";
export { GameSceneController } from "./presentation/game_scene_controller";
export { type DisplayEntry, RegionUnitDisplay } from "./presentation/region_unit_display";
export { PCG, type PcgSeed, type PcgState } from "./rng/pcg";
export { Ruleset } from "./rules/ruleset";
export { RulesetClassic } from "./rules/ruleset_classic";
export { type CommandResult, GameSession } from "./session/game_session";
export { GameSessionAdapter, type SessionLike } from "./session/game_session_adapter";
export { createSessionFromNewmap, GameSessionFactory, SessionMode } from "./session/game_session_factory";
export { type CanonicalEvent, GameSessionStub, type StubResult } from "./session/game_session_stub";
export { TransportLoadValidator } from "./transport/transport_load_validator";
export { PHASES, TurnEngine, type TurnPhase } from "./turn/turn_engine";
export { CommandValidator, PHASE_COMMANDS } from "./validation/command_validator";
export { EventSchemaValidator } from "./validation/event_schema_validator";
export {
  CombatMove,
  CombatMovementBatch,
  CombatMovementValidationResult,
  MoveError,
  NonCombatMove,
  NonCombatMovementBatch,
  PlaneLandingDependency,
  SpecialAction,
  UnitMovePreview,
  ValidationResult,
} from "./validation/validation_types";
export { VictoryEngine } from "./victory/victory";

import type { Dict } from "./model/types";
import type { CommandResult, GameSession } from "./session/game_session";
import type { GameSessionStub, StubResult } from "./session/game_session_stub";

/**
 * Public session boundary from ENGINE_PORT_PLAN.md:
 * `applyCommand(cmd) -> { result_type, error?, events, new_state }` for GameSession,
 * and `{ result_type, error?, events }` with canonical events for the demo stub.
 */
export function applyCommand(session: GameSession, cmd: Dict): CommandResult;
export function applyCommand(session: GameSessionStub, cmd: Dict): StubResult;
export function applyCommand(session: GameSession | GameSessionStub, cmd: Dict): CommandResult | StubResult {
  return session.applyCommand(cmd);
}
