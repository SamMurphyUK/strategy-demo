// The label a unit shows when the pointer rests on its stack. Pure.

/**
 * `historic` is the faction's own name for the unit, `name` its type, and `count` the units in the
 * stack. The count shows only when there is more than one: "Stahlhelm infantry (Infantry × 3)" for
 * three, "Stahlhelm infantry (Infantry)" for one. A unit with no historic name is its type, and
 * "Infantry × 3" for three.
 */
export function stackLabel(historic: string | null | undefined, name: string, count: number): string {
  const many = Number.isFinite(count) && count > 1;
  const counted = many ? `${name} × ${Math.floor(count)}` : name;
  return historic ? `${historic} (${counted})` : counted;
}
