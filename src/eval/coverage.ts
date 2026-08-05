// Which questions in this catalog are contested, and what canon does with all
// of them.
//
// The demo answers one question. That is a fair thing to be suspicious of: a
// single hand-picked question is exactly what you would show if it were the
// only one that worked. So this file finds every contested subject in the
// catalog structurally, and the runner puts all of them through the adjudicator.
//
// "Contested" is deliberately narrow. It does NOT mean "unhealthy", "untagged"
// or "undocumented" — catalog health dashboards are a thing DataHub already
// ships, and rebuilding one would be both redundant and off-topic. It means
// exactly one thing: more than one asset answers to the same concept, so
// somebody has to choose. That is the only population canon has any business
// reporting on.
//
// Discovery reads names only. It does not look at scores, rules, lineage or
// anything canon would use to decide — it just partitions the catalog into
// concepts and hands over the ones with more than one member.

import type { DataHubClient } from "../datahub/client.ts";
import type { DatasetEntity, Urn } from "../datahub/types.ts";

/** Stage prefixes that describe a pipeline position, not a different thing. */
const STAGE_PREFIX = /^(stg|fct|dim|int|raw|mart|vw|v|tmp|temp|agg|base|ods)[_-]/;

/** Grain words. `daily_revenue` and `revenue_daily` are the same concept. */
const GRAIN_WORD = /^(daily|weekly|monthly|hourly|yearly|annual|rolling|current|latest)$/;

/** Suffixes marking a copy or a point in time rather than a distinct concept. */
const COPY_SUFFIX = /^(snapshot|history|hist|archive|archived|backup|copy|explore|bak|old|v\d+|\d{4})$/;

export type ContestedSubject = {
  /** The concept, as a human would say it. Used as both subject and search query. */
  subject: string;
  members: Urn[];
  /** Distinct platforms the concept is materialised on. */
  platforms: string[];
};

/** `ANALYTICS.MARTS.FCT_ORDERS` -> `orders`; `growth.metrics.daily_revenue` -> `revenue`. */
export function conceptKey(name: string): string {
  const leaf = (name.split(".").pop() ?? name).toLowerCase();
  const stripped = leaf.replace(STAGE_PREFIX, "");
  const parts = stripped
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((t) => !GRAIN_WORD.test(t) && !COPY_SUFFIX.test(t));
  if (parts.length === 0) return stripped;
  // Singularise the last token only. `purchase_orders` and `orders` stay
  // different concepts, which they are — one is a supplier PO.
  const last = parts[parts.length - 1] ?? "";
  parts[parts.length - 1] = last.endsWith("ies")
    ? `${last.slice(0, -3)}y`
    : last.endsWith("s") && !last.endsWith("ss")
      ? last.slice(0, -1)
      : last;
  return parts.join("_");
}

/**
 * Every concept in the catalog that more than one asset answers to.
 *
 * Sorted most-contested first, because that is the order a platform team would
 * work the list in.
 */
export function findContested(entities: DatasetEntity[]): ContestedSubject[] {
  const groups = new Map<string, DatasetEntity[]>();
  for (const e of entities) {
    const key = conceptKey(e.name);
    if (!key) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(e);
    else groups.set(key, [e]);
  }

  const out: ContestedSubject[] = [];
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    out.push({
      subject: key.replace(/_/g, " "),
      members: members.map((m) => m.urn),
      platforms: [...new Set(members.map((m) => m.platform))].sort(),
    });
  }
  return out.sort((a, b) => b.members.length - a.members.length || a.subject.localeCompare(b.subject));
}

/** What canon did with one contested subject. */
export type SubjectOutcome = {
  subject: string;
  candidates: number;
  platforms: string[];
  outcome: "RESOLVED" | "ABSTAIN";
  confidence?: "high" | "medium" | "low";
  mechanism: string;
  canonical?: string;
  /** Why it abstained, when it did. */
  cause?: string;
  /** What the catalog would need to carry for canon to decide. */
  missing?: string[];
  ms: number;
  modelCalls: number;
  graphReads: number;
};

export type Posture = {
  entities: number;
  contested: number;
  ruled: number;
  /** Abstained because two genuinely different definitions share a word. */
  referredToOwners: number;
  /** Abstained because the catalog does not carry enough evidence to separate them. */
  needsMoreEvidence: number;
  outcomes: SubjectOutcome[];
  /**
   * The abstentions, turned round. Each row is a kind of missing metadata and
   * how many subjects it is currently blocking — which makes the refusals a
   * prioritised work list rather than a list of failures.
   */
  backlog: Array<{ need: string; blocks: number }>;
  totals: { ms: number; modelCalls: number; graphReads: number };
};

/**
 * Collapses "17 rows short of the leader on assertions" and friends into the
 * shape of the gap, so counting them means something.
 */
function needShape(missing: string): string {
  const m = missing.toLowerCase();
  if (/assertion|data.quality|test/.test(m)) return "data-quality assertions on the candidates";
  if (/owner/.test(m)) return "a named owner";
  if (/descri|document/.test(m)) return "a curated description";
  if (/tier|certif/.test(m)) return "a trust tier";
  if (/lineage|upstream|derive/.test(m)) return "lineage that distinguishes them";
  if (/fresh|stale|operation/.test(m)) return "freshness signal";
  if (/measure|semantic|column|grain/.test(m)) return "measure semantics on the columns";
  if (/usage|quer/.test(m)) return "usage statistics";
  return missing.length > 70 ? `${missing.slice(0, 67)}…` : missing;
}

export function summarisePosture(entities: number, outcomes: SubjectOutcome[]): Posture {
  const counts = new Map<string, number>();
  for (const o of outcomes) {
    // One vote per subject per shape, so a subject listing three assertion
    // gripes does not outweigh three separate subjects.
    for (const need of new Set((o.missing ?? []).map(needShape))) {
      counts.set(need, (counts.get(need) ?? 0) + 1);
    }
  }
  const backlog = [...counts.entries()]
    .map(([need, blocks]) => ({ need, blocks }))
    .sort((a, b) => b.blocks - a.blocks || a.need.localeCompare(b.need));

  return {
    backlog,
    entities,
    contested: outcomes.length,
    ruled: outcomes.filter((o) => o.outcome === "RESOLVED").length,
    referredToOwners: outcomes.filter((o) => o.cause === "COMPETING_DEFINITIONS").length,
    needsMoreEvidence: outcomes.filter(
      (o) => o.outcome === "ABSTAIN" && o.cause !== "COMPETING_DEFINITIONS",
    ).length,
    outcomes,
    totals: {
      ms: Math.round(outcomes.reduce((a, o) => a + o.ms, 0)),
      modelCalls: outcomes.reduce((a, o) => a + o.modelCalls, 0),
      graphReads: outcomes.reduce((a, o) => a + o.graphReads, 0),
    },
  };
}

/** Reads the whole catalog out of a client, for discovery. */
export async function allEntities(client: DataHubClient, probe = "a"): Promise<DatasetEntity[]> {
  const seen = new Map<Urn, DatasetEntity>();
  // Mock and live both rank by relevance, so a handful of broad probes covers
  // more of the catalog than one. Discovery is best-effort by construction and
  // the runner says how many entities it actually saw.
  for (const q of [probe, "e", "i", "o", "u", "_"]) {
    const res = await client.search(q, { limit: 500 });
    const fetched = await client.getEntities(res.hits.map((h) => h.urn));
    for (const e of fetched) seen.set(e.urn, e);
  }
  return [...seen.values()];
}
