// The evidence weights.
//
// This table IS the adjudicator. It is exported as data, printed by
// `npm run rules`, rendered in the HTML report and re-read by the eval, so the
// weights a judge sees are the weights that ran.
//
// Two properties are load-bearing and deliberate:
//
//   1. No language model is involved in the decision. Every rule reads a
//      DataHub aspect and returns a signed number. The same catalog always
//      produces the same ruling, which is what lets the falsification demo
//      (`npm run poison`) change the answer on camera and lets the eval score
//      the adjudicator over scenarios nobody hand-tuned.
//
//   2. Popularity is worth almost nothing. `usage.human_adoption` caps at +6
//      while a passing assertion is worth +14 each. That asymmetry is the
//      product's argument, expressed as arithmetic rather than as prose: the
//      table four analysts query every week is evidence of a live problem, not
//      evidence that it is canonical.

import type { CandidateEvidence } from "./types.ts";
import type { Urn } from "../datahub/types.ts";

export const THRESHOLDS = {
  /** Days without a write before freshness starts counting against a candidate. */
  staleDays: 2,
  /** Penalty per stale day, and its cap. */
  stalePerDay: 9,
  staleFloor: -45,
  /** Minimum score gap between 1st and 2nd before canon will call a winner. */
  decisiveMargin: 25,
  /** Gap above which confidence is `high`. */
  confidentMargin: 60,
} as const;

export type RuleHit = {
  rule: string;
  delta: number;
  because: string;
};

export type RuleDef = {
  id: string;
  /** What aspect of the DataHub graph this reads. Printed in the evidence rail. */
  aspect: string;
  /** Human sentence for the rules table. */
  says: string;
  apply: (c: CandidateEvidence, ctx: ScoreContext) => RuleHit | null;
};

export type ScoreContext = {
  /** Every candidate in the same definition class, including this one. */
  cohort: CandidateEvidence[];
  /** Wall clock the freshness rules measure against. */
  now: number;
};

function hit(rule: string, delta: number, because: string): RuleHit {
  return { rule, delta, because };
}

const CERTIFIED = /(^|:)certified$/i;
const DEPRECATED_TAG = /(^|:)deprecated$/i;
const PII = /(pii|personal|gdpr|sensitive)/i;

/**
 * Trust tiers, as a catalog with a governance model actually records them.
 *
 * The convention canon reads is the common one: a small ordered ladder where
 * the top tier means reviewed, owned and documented, and the bottom means
 * temporary or personal. `Certified` is treated as the top tier because it is
 * the same statement in a different vocabulary — someone signed off.
 *
 * `Production` is deliberately NOT a tier. It says which environment an asset
 * lives in, not how far it can be trusted, and conflating the two is how a
 * staging copy in the production account ends up outranking a reviewed mart.
 */
const TIER_PATTERNS: Array<{ level: 1 | 2 | 3; re: RegExp }> = [
  { level: 1, re: /(^|:)(tier[\s_-]?1|gold|certified)$/i },
  { level: 2, re: /(^|:)(tier[\s_-]?2|silver)$/i },
  { level: 3, re: /(^|:)(tier[\s_-]?3|bronze)$/i },
];

/** What each tier is worth. Top tier keeps `Certified`'s original weight. */
const TIER_WEIGHT: Record<1 | 2 | 3, number> = { 1: 16, 2: 6, 3: -12 };

const TIER_SAYS: Record<1 | 2 | 3, string> = {
  1: "the organisation's top trust tier — reviewed, owned and documented",
  2: "a team-owned middle tier — owned, but not reviewed to the top standard",
  3: "the bottom tier: temporary or personal, and usually on a retention clock",
};

function tagName(urn: Urn): string {
  return urn.split(":").pop() ?? urn;
}

/**
 * The highest tier this asset declares, across tags and glossary terms.
 *
 * Highest wins when an asset carries more than one, because a catalog in the
 * middle of a re-tiering exercise routinely has both the old and new label on
 * the same asset, and the generous reading is the one that does not silently
 * demote things during a migration.
 */
function declaredTier(c: CandidateEvidence): { level: 1 | 2 | 3; label: string } | null {
  const labels = [...c.entity.tags, ...c.entity.glossaryTerms].map(tagName);
  let best: { level: 1 | 2 | 3; label: string } | null = null;
  for (const label of labels) {
    for (const { level, re } of TIER_PATTERNS) {
      if (re.test(label) && (best === null || level < best.level)) best = { level, label };
    }
  }
  return best;
}

function hasPii(c: CandidateEvidence): boolean {
  const onEntity = [...c.entity.tags, ...c.entity.glossaryTerms].some((t) => PII.test(t));
  const onColumns = c.entity.schema.some((f) =>
    [...(f.glossaryTerms ?? []), ...(f.tags ?? [])].some((t) => PII.test(t)),
  );
  return onEntity || onColumns;
}

/**
 * The rules, in the order they are reported. Order has no effect on the total —
 * the score is a sum — but it is the order the report renders, so it reads as
 * an argument: where the thing sits, whether it is current, whether it is
 * tested, who owns it, how it is governed, and only then who uses it.
 */
export const RULES: RuleDef[] = [
  {
    id: "lineage.modelled",
    aspect: "upstreamLineage.type",
    says: "Derived by a TRANSFORMED edge and consumed downstream — business logic has been applied to it and something depends on the result.",
    apply: (c) => {
      const transformed = c.entity.upstreams.some((u) => u.type === "TRANSFORMED");
      if (!transformed || c.downstreamCount === 0) return null;
      return hit(
        "lineage.modelled",
        32,
        `derived through a TRANSFORMED edge and feeds ${c.downstreamCount} downstream asset${c.downstreamCount === 1 ? "" : "s"}`,
      );
    },
  },
  {
    id: "lineage.landing_copy",
    aspect: "upstreamLineage.type",
    says: "Reached by a COPY edge: a landing copy of something else, with no business rules applied.",
    apply: (c) => {
      const copy = c.entity.upstreams.filter((u) => u.type === "COPY");
      if (copy.length === 0) return null;
      return hit(
        "lineage.landing_copy",
        -28,
        `a COPY of ${copy.map((u) => shortName(u.dataset)).join(", ")} — no business rules applied in transit`,
      );
    },
  },
  {
    id: "lineage.operational_source",
    aspect: "upstreamLineage",
    says: "Has no upstreams and is written by an application: rows mutate in place, so it cannot be reproduced as of a past date.",
    apply: (c) => {
      if (c.entity.upstreams.length > 0 || c.downstreamCount === 0) return null;
      const mutating = c.entity.operation?.operationType === "UPDATE";
      if (!mutating) return null;
      return hit(
        "lineage.operational_source",
        -36,
        "the application table everything else derives from — last operation was an UPDATE, so rows mutate in place",
      );
    },
  },
  {
    id: "lineage.orphan",
    aspect: "upstreamLineage",
    says: "Neither derived from anything nor feeding anything — a dead end in the graph.",
    apply: (c) => {
      if (c.entity.upstreams.length > 0 || c.downstreamCount > 0) return null;
      return hit("lineage.orphan", -20, "no upstreams and no downstream consumers — nothing maintains it");
    },
  },
  {
    id: "freshness.current",
    aspect: "operation.lastUpdatedTimestamp",
    says: "Written within the staleness window.",
    apply: (c) => {
      if (c.stalenessDays === null || c.stalenessDays > THRESHOLDS.staleDays) return null;
      return hit("freshness.current", 10, `written ${describeAge(c.stalenessDays)}`);
    },
  },
  {
    id: "freshness.stale",
    aspect: "operation.lastUpdatedTimestamp",
    says: "Behind the staleness window. Scales with how far behind, floored so that one very old table cannot dominate the whole score.",
    apply: (c) => {
      if (c.stalenessDays === null || c.stalenessDays <= THRESHOLDS.staleDays) return null;
      const delta = Math.max(
        THRESHOLDS.staleFloor,
        -Math.round((c.stalenessDays - THRESHOLDS.staleDays) * THRESHOLDS.stalePerDay),
      );
      return hit("freshness.stale", delta, `last written ${describeAge(c.stalenessDays)} — ${c.stalenessDays.toFixed(1)} days behind`);
    },
  },
  {
    id: "assertions.passing",
    aspect: "assertionRunEvent",
    says: "Each data-quality assertion currently passing. Someone wrote a test and it is green.",
    apply: (c) => {
      const pass = (c.entity.assertions ?? []).filter((a) => a.lastResult === "SUCCESS");
      if (pass.length === 0) return null;
      return hit(
        "assertions.passing",
        14 * pass.length,
        `${pass.length} passing assertion${pass.length === 1 ? "" : "s"}: ${pass.map((a) => a.type.toLowerCase()).join(", ")}`,
      );
    },
  },
  {
    id: "assertions.failing",
    aspect: "assertionRunEvent",
    says: "Each assertion currently failing. A red test on a candidate is disqualifying evidence, not a warning.",
    apply: (c) => {
      const fail = (c.entity.assertions ?? []).filter(
        (a) => a.lastResult === "FAILURE" || a.lastResult === "ERROR",
      );
      if (fail.length === 0) return null;
      return hit(
        "assertions.failing",
        -24 * fail.length,
        `${fail.length} failing assertion${fail.length === 1 ? "" : "s"}: ${fail.map((a) => `${a.type.toLowerCase()} (${a.description})`).join("; ")}`,
      );
    },
  },
  {
    id: "assertions.untested",
    aspect: "assertionRunEvent",
    says: "No assertions at all. Not an accusation — an absence of evidence, priced small.",
    apply: (c) => {
      if ((c.entity.assertions ?? []).length > 0) return null;
      return hit("assertions.untested", -6, "no data-quality assertions defined");
    },
  },
  {
    id: "deprecation.marked",
    aspect: "deprecation",
    says: "Already marked deprecated in DataHub. Someone has said out loud that this is not it.",
    apply: (c) =>
      c.entity.deprecation?.deprecated
        ? hit("deprecation.marked", -70, `deprecated in DataHub: ${c.entity.deprecation.note ?? "no note"}`)
        : null,
  },
  {
    id: "ownership.technical",
    aspect: "ownership",
    says: "Has a named technical owner — there is someone to page.",
    apply: (c) => {
      const o = c.entity.owners.filter((x) => x.type === "TECHNICAL_OWNER" || x.type === "DATAOWNER");
      if (o.length === 0) return null;
      return hit("ownership.technical", 11, `technical owner ${o.map((x) => shortActor(x.owner)).join(", ")}`);
    },
  },
  {
    id: "ownership.business",
    aspect: "ownership",
    says: "Has a named business owner — someone owns the definition, not just the pipeline.",
    apply: (c) => {
      const o = c.entity.owners.filter((x) => x.type === "BUSINESS_OWNER");
      if (o.length === 0) return null;
      return hit("ownership.business", 9, `business owner ${o.map((x) => shortActor(x.owner)).join(", ")}`);
    },
  },
  {
    id: "ownership.none",
    aspect: "ownership",
    says: "Nobody owns it. An unowned table that four people query is an incident waiting to happen.",
    apply: (c) => (c.entity.owners.length === 0 ? hit("ownership.none", -18, "no owner of any kind recorded") : null),
  },
  {
    id: "docs.curated",
    aspect: "editableDatasetProperties.description",
    says: "A human wrote the description, rather than it being harvested from the source.",
    apply: (c) =>
      c.entity.descriptionIsCurated && c.entity.description
        ? hit("docs.curated", 8, "human-written description on the asset")
        : null,
  },
  {
    id: "docs.absent",
    aspect: "datasetProperties.description",
    says: "No description at all.",
    apply: (c) => (c.entity.description ? null : hit("docs.absent", -7, "no description")),
  },
  {
    id: "governance.tier",
    aspect: "globalTags / glossaryTerms",
    says:
      "The trust tier the organisation already assigned it — Tier 1 / Certified down to Tier 3. " +
      "canon reads the catalog's own governance model rather than inventing a parallel one, and " +
      "never writes a tier: classifying assets is the catalog's job, adjudicating between them is canon's.",
    apply: (c) => {
      const tier = declaredTier(c);
      if (!tier) return null;
      const certified = CERTIFIED.test(tier.label);
      return hit(
        "governance.tier",
        TIER_WEIGHT[tier.level],
        `${certified ? "tagged Certified" : `tagged ${tier.label}`} — ${TIER_SAYS[tier.level]}`,
      );
    },
  },
  {
    id: "tag.deprecated",
    aspect: "globalTags",
    says: "Carries a Deprecated tag even if the deprecation aspect was never set.",
    apply: (c) => {
      const t = c.entity.tags.filter((x) => DEPRECATED_TAG.test(tagName(x)));
      if (t.length === 0) return null;
      return hit("tag.deprecated", -22, "tagged Deprecated");
    },
  },
  {
    id: "governance.pii_exposed",
    aspect: "glossaryTerms / schemaMetadata.glossaryTerms",
    says: "Carries PII while a non-PII sibling in the same definition class exists. Governance outranks convenience.",
    apply: (c, ctx) => {
      if (!hasPii(c)) return null;
      const cleanAlternative = ctx.cohort.some((o) => o.entity.urn !== c.entity.urn && !hasPii(o));
      if (!cleanAlternative) return null;
      return hit(
        "governance.pii_exposed",
        -20,
        "carries PII and a non-PII alternative for the same fact exists in this class",
      );
    },
  },
  {
    id: "siblings.definition",
    aspect: "siblings",
    says: "DataHub says this is the primary of a sibling pair: the dbt model is the definition, the warehouse table is the materialisation.",
    apply: (c) => {
      if (!c.entity.siblingPrimary || !c.siblingOf) return null;
      return hit("siblings.definition", 13, `DataHub sibling-primary — defines ${shortName(c.siblingOf)}`);
    },
  },
  {
    id: "glossary.classified",
    aspect: "glossaryTerms",
    says: "Attached to a business glossary term, so the catalog already knows what domain it belongs to.",
    apply: (c) => {
      const t = c.entity.glossaryTerms.filter((x) => !PII.test(x));
      if (t.length === 0) return null;
      return hit("glossary.classified", 7, `glossary term ${t.map((x) => x.split(":").pop()).join(", ")}`);
    },
  },
  {
    id: "usage.human_adoption",
    aspect: "datasetUsageStatistics",
    says: "Humans query it. Capped at +6 on purpose: popularity is habit, and habit is what put the wrong number in the board deck.",
    apply: (c) => {
      if (c.humanQueryCount === 0) return null;
      const delta = Math.min(6, Math.ceil(c.humanQueryCount / 100));
      return hit(
        "usage.human_adoption",
        delta,
        `${c.humanQueryCount} human queries in 30 days (capped contribution: popularity is not evidence)`,
      );
    },
  },
  {
    id: "usage.machines_only",
    aspect: "datasetUsageStatistics.topUsers",
    says: "Only service accounts touch it — it is plumbing, not an answer.",
    apply: (c) => {
      if (c.humanQueryCount > 0 || c.serviceQueryCount === 0) return null;
      return hit("usage.machines_only", -8, `${c.serviceQueryCount} queries, all from service accounts`);
    },
  },
];

export function shortName(urn: Urn): string {
  const m = /urn:li:dataset:\(urn:li:dataPlatform:([^,]+),([^,]+),/.exec(urn);
  return m ? `${m[1]}:${m[2]}` : urn;
}

export function shortActor(urn: Urn): string {
  return urn.split(":").pop() ?? urn;
}

export function describeAge(days: number | null): string {
  if (days === null) return "at an unknown time";
  if (days < 0.04) return "in the last hour";
  if (days < 1) return `${Math.round(days * 24)} hours ago`;
  return `${days.toFixed(1)} days ago`;
}
