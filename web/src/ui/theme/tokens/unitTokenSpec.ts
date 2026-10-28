// Which art and which serif letter each unit type gets. Pure.
//
// Art lives in public/assets/units/. Only infantry has distinct allied art; every other unit has one
// axis_* drawing that is recoloured per faction. Units with no art yet are letter-only tokens.

import type { FactionSide } from "../factionPalette";

export interface UnitTokenSpec {
  /** Serif letter shown at the top of the token when the art leaves room for it. */
  letter: string;
  /** File names (no extension) under assets/units. Missing sides fall back to whichever side exists. */
  art?: { axis?: string; allies?: string };
}

export const UNIT_TOKEN_SPEC: Record<string, UnitTokenSpec> = {
  infantry: { letter: "I", art: { axis: "axis_inf_ii", allies: "allies_inf_ii" } },
  mech_infantry: { letter: "M", art: { axis: "axis_inf_ii", allies: "allies_inf_ii" } },
  artillery: { letter: "A", art: { axis: "axis_art" } },
  tank: { letter: "K", art: { axis: "axis_tank" } },
  aaa: { letter: "G", art: { axis: "axis_aa" } },
  fighter: { letter: "F" },
  tactical_bomber: { letter: "L" },
  strategic_bomber: { letter: "H" },
  submarine: { letter: "S", art: { axis: "axis_sub" } },
  destroyer: { letter: "D", art: { axis: "axis_des" } },
  cruiser: { letter: "C", art: { axis: "axis_cruiser" } },
  transport: { letter: "T", art: { axis: "axis_trans" } },
  battleship: { letter: "B" },
  carrier: { letter: "V" },
};

export interface ResolvedTokenSpec {
  letter: string;
  artName: string | null;
}

export function resolveTokenSpec(unitTypeId: string, side: FactionSide): ResolvedTokenSpec {
  const spec = UNIT_TOKEN_SPEC[unitTypeId];
  if (!spec) return { letter: (unitTypeId[0] ?? "?").toUpperCase(), artName: null };
  const art = spec.art;
  if (!art) return { letter: spec.letter, artName: null };
  const preferred = side === "allies" ? art.allies : art.axis;
  return { letter: spec.letter, artName: preferred ?? art.axis ?? art.allies ?? null };
}
