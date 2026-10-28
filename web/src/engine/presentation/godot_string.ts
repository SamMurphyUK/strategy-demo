/**
 * Godot `String.capitalize()`: splits snake_case and camelCase into words and
 * capitalizes each one ("mech_infantry" -> "Mech Infantry").
 */
export function godotCapitalize(input: string): string {
  const spaced = input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  return spaced.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}
