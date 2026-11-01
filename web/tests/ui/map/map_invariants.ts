type Dict = Record<string, any>;

const isPoint = (p: unknown): boolean =>
  Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

const isRing = (ring: unknown): boolean => Array.isArray(ring) && ring.length >= 3 && ring.every(isPoint);

/**
 * Structural checks that hold for any map the editor can save, however many regions it has: unique ids,
 * real outlines, an anchor on every region, and neighbor lists that name real regions and agree both ways.
 * Returns the problems found, so a failing test prints them all.
 */
export function mapIntegrityProblems(mapJson: Dict): string[] {
  const problems: string[] = [];
  const regions: Dict[] = Array.isArray(mapJson.regions) ? mapJson.regions : [];
  const ids = regions.map((r) => String(r.metadata?.region_id ?? ""));
  const known = new Set(ids);

  if (!regions.some((r) => r.metadata?.is_sea !== true && r.metadata?.type !== "sea")) {
    problems.push("no land region");
  }
  if (!regions.some((r) => r.metadata?.is_sea === true || r.metadata?.type === "sea")) {
    problems.push("no sea region");
  }

  const seen = new Set<string>();
  for (const id of ids) {
    if (id === "") {
      problems.push("a region has no id");
    } else if (seen.has(id)) {
      problems.push(`duplicate id ${id}`);
    }
    seen.add(id);
  }

  regions.forEach((r, i) => {
    const id = ids[i];
    if (!isRing(r.polygon)) {
      problems.push(`${id}: polygon needs at least 3 finite points`);
    }
    for (const ring of r.extra_polygons ?? []) {
      if (!isRing(ring)) {
        problems.push(`${id}: an extra island needs at least 3 finite points`);
      }
    }
    const anchor = (r.anchors ?? [])[0];
    if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
      problems.push(`${id}: missing unit anchor (cx, cy)`);
    }
    for (const n of Array.isArray(r.neighbors) ? r.neighbors : []) {
      if (n === id) {
        problems.push(`${id}: lists itself as a neighbor`);
      } else if (!known.has(n)) {
        problems.push(`${id}: neighbor ${n} does not exist`);
      } else {
        const other = regions[ids.indexOf(n)];
        if (!(Array.isArray(other.neighbors) && other.neighbors.includes(id))) {
          problems.push(`${id} -> ${n}: link is not symmetrical`);
        }
      }
    }
  });
  return problems;
}
