// Poisoning the catalog, in one place.
//
// Both `npm run poison` (the CLI proof) and the demo report's what-if beat need
// to break the winner in exactly the same way. If they drifted apart, the thing
// shown on camera would stop being the thing the script verifies — so there is
// one implementation and both import it.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface PoisonResult {
  /** Path to the poisoned copy. The original fixture is never modified. */
  path: string;
  /** Human-readable list of what was broken, in the order it was applied. */
  changes: string[];
}

/**
 * Writes a copy of `catalogPath` with the winner deprecated, unowned, all of its
 * assertions failing and its Certified tag stripped.
 *
 * Nothing about the adjudicator changes — only the graph it reads. That is the
 * whole point of the beat: if the ruling still moves, the evidence is reaching
 * the verdict.
 */
export function poisonWinner(catalogPath: string, winnerUrn: string): PoisonResult {
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as {
    entities: Array<Record<string, unknown>>;
  };
  const changes: string[] = [];

  for (const e of catalog.entities) {
    if (e["urn"] !== winnerUrn) continue;
    e["deprecation"] = { deprecated: true, note: "DECOMMISSIONED. Do not use." };
    changes.push("set deprecation.deprecated = true");
    e["owners"] = [];
    changes.push("removed every owner");
    const assertions = (e["assertions"] ?? []) as Array<Record<string, unknown>>;
    for (const a of assertions) a["lastResult"] = "FAILURE";
    changes.push(`failed all ${assertions.length} assertions`);
    const tags = (e["tags"] ?? []) as string[];
    e["tags"] = tags.filter((t) => !/Certified/.test(t));
    changes.push("removed the Certified tag");
  }

  const dir = mkdtempSync(join(tmpdir(), "canon-poison-"));
  const path = join(dir, "catalog.poisoned.json");
  writeFileSync(path, JSON.stringify(catalog, null, 2));
  return { path, changes };
}
