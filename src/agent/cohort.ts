// The duplicate-vs-different-definition test.
//
// This is the mechanism the whole product rests on, so it runs before any
// scoring and it is deterministic.
//
// Two assets that both answer to the name "revenue" are one of two things:
//
//   DUPLICATES            the same business fact materialised more than once —
//                         a landing copy, a modelled table, a warehouse sibling,
//                         a frozen snapshot. Exactly one of them should be cited.
//                         A catalog CAN pick a winner, so canon rules.
//
//   DIFFERENT DEFINITIONS genuinely different business facts that share a word.
//                         Finance's "recognised revenue, net of refunds, excluding
//                         shipping" and Growth's "gross bookings including
//                         shipping" are both correct. No amount of lineage,
//                         freshness or ownership metadata can pick between them,
//                         because the disagreement is organisational, not
//                         technical. canon ABSTAINS and files the question to the
//                         owners who can actually settle it.
//
// Ruling on a different-definitions pair is the worst failure available to this
// product: it launders a disagreement into a fact. So the partition gates the
// scorer rather than the scorer gating the partition.

import type { DatasetEntity, SchemaField, Urn } from "../datahub/types.ts";
import type { CandidateEvidence } from "./types.ts";

/**
 * Measure semantics we can read straight off column names. Deliberately small
 * and explicit — an unrecognised measure contributes NO semantic marker rather
 * than a guessed one, so the partition fails towards "duplicate" (rule) rather
 * than towards "different" (abstain). Abstaining is cheap to claim and hard to
 * check, so the mechanism must not reach for it.
 */
const MEASURE_SEMANTICS: Array<{ marker: string; tokens: string[] }> = [
  { marker: "GROSS", tokens: ["gross", "booking", "bookings", "booked"] },
  { marker: "NET", tokens: ["net", "recognised", "recognized", "settled"] },
  { marker: "REFUND", tokens: ["refund", "refunds", "chargeback"] },
  { marker: "TAX", tokens: ["tax", "vat"] },
  { marker: "SHIPPING", tokens: ["shipping", "freight", "postage"] },
  { marker: "COUNT", tokens: ["count", "qty", "quantity", "units"] },
];

const DATE_TYPES = /(date|time|timestamp|datetime)/i;
const NUMERIC_TYPES = /(int|numeric|decimal|float|double|number|money|bigint|real)/i;

export type SemanticFingerprint = {
  /** Identity + time columns: what one row of this thing IS. */
  grainKeys: string[];
  /** Numeric non-identity columns: what this thing MEASURES. */
  measures: string[];
  /** Which measure semantics the column names actually declare. */
  markers: string[];
  /** True when the grain is a calendar period rather than an entity. */
  periodGrain: boolean;
  /** Glossary terms — DataHub's own statement of what domain this belongs to. */
  terms: Urn[];
};

/** Normalises platform casing so ORDER_ID and order_id are one column. */
function norm(field: string): string {
  return field.trim().toLowerCase().replace(/^_+|_+$/g, "");
}

function tokens(field: string): string[] {
  return norm(field).split(/[^a-z0-9]+/).filter(Boolean);
}

function isGrainKey(f: SchemaField): boolean {
  const n = norm(f.fieldPath);
  if (DATE_TYPES.test(f.nativeDataType)) return true;
  if (n === "id" || n.endsWith("_id") || n.endsWith("_key")) return true;
  // Bare date-ish names survive platforms that type everything as TEXT (the
  // nyc-taxi datapack does exactly this).
  return /(^|_)(date|dt|day|month|week|year|at)$/.test(n);
}

function isMeasure(f: SchemaField): boolean {
  if (isGrainKey(f)) return false;
  if (NUMERIC_TYPES.test(f.nativeDataType)) return true;
  return /(amount|revenue|total|value|cents|usd|price|cost|count|qty)/.test(norm(f.fieldPath));
}

export function fingerprint(entity: DatasetEntity): SemanticFingerprint {
  const grainKeys: string[] = [];
  const measures: string[] = [];
  for (const f of entity.schema) {
    if (isGrainKey(f)) grainKeys.push(norm(f.fieldPath));
    else if (isMeasure(f)) measures.push(norm(f.fieldPath));
  }

  const markers = new Set<string>();
  for (const m of measures) {
    const tk = tokens(m);
    for (const { marker, tokens: lex } of MEASURE_SEMANTICS) {
      if (tk.some((t) => lex.includes(t))) markers.add(marker);
    }
  }

  // A period grain has no entity identity — only a calendar column.
  const entityKeys = grainKeys.filter((k) => k === "id" || k.endsWith("_id") || k.endsWith("_key"));
  const periodGrain = grainKeys.length > 0 && entityKeys.length === 0;

  return {
    grainKeys,
    measures,
    markers: [...markers].sort(),
    periodGrain,
    terms: [...entity.glossaryTerms].sort(),
  };
}

export type CompatibilityVerdict = {
  compatible: boolean;
  /** Named reason, printed in the ruling and the report. */
  reason: string;
};

/**
 * Are these two candidates the same business fact materialised twice?
 *
 * The test is intentionally asymmetric in what it treats as decisive. Grain is
 * structural and cheap to read, so a grain mismatch is decisive. Measure
 * semantics are decisive ONLY when both sides declare a marker and the sets are
 * disjoint — a materialisation that carries both gross and net columns is
 * compatible with a table carrying either.
 */
export function compatible(a: CandidateEvidence, b: CandidateEvidence): CompatibilityVerdict {
  const fa = fingerprint(a.entity);
  const fb = fingerprint(b.entity);

  if (fa.grainKeys.length === 0 || fb.grainKeys.length === 0) {
    return { compatible: false, reason: "one side declares no schema, so its grain cannot be read" };
  }

  if (fa.periodGrain !== fb.periodGrain) {
    return {
      compatible: false,
      reason: fa.periodGrain
        ? "different grain: one row per calendar period vs one row per entity"
        : "different grain: one row per entity vs one row per calendar period",
    };
  }

  // Entity grains must agree on their identity columns. Period grains are all
  // "one row per day" and their column happens to be called dt or revenue_date.
  if (!fa.periodGrain) {
    const ea = new Set(fa.grainKeys.filter((k) => k !== "id" && !DATE_ONLY.test(k)));
    const eb = new Set(fb.grainKeys.filter((k) => k !== "id" && !DATE_ONLY.test(k)));
    const shared = [...ea].filter((k) => eb.has(k));
    if (ea.size > 0 && eb.size > 0 && shared.length === 0) {
      return {
        compatible: false,
        reason: `different grain: keyed on ${[...ea].join("+")} vs ${[...eb].join("+")}`,
      };
    }
  }

  const ma = new Set(fa.markers);
  const mb = new Set(fb.markers);
  if (ma.size > 0 && mb.size > 0) {
    const overlap = [...ma].filter((m) => mb.has(m));
    if (overlap.length === 0) {
      return {
        compatible: false,
        reason:
          `different measure definition: ${[...ma].join("/")} (${fa.measures.join(", ")}) ` +
          `vs ${[...mb].join("/")} (${fb.measures.join(", ")})`,
      };
    }
  }

  return { compatible: true, reason: "same grain, compatible measure semantics" };
}

const DATE_ONLY = /(^|_)(date|dt|day|month|week|year|at)$/;

export type DefinitionClass = {
  id: string;
  members: CandidateEvidence[];
  /** Why this class is separate from the others. */
  separatedBy: string[];
};

export type Partition = {
  classes: DefinitionClass[];
  /** Candidates with no readable schema — cannot be adjudicated either way. */
  unreadable: CandidateEvidence[];
};

/**
 * Greedy transitive grouping. A candidate joins the first class whose every
 * member it is compatible with; otherwise it opens a new class. Requiring
 * compatibility with EVERY member (not just one) keeps a permissive
 * materialisation from bridging two genuinely different definitions into one
 * class — the failure that would produce a confident ruling on an
 * unanswerable question.
 */
export function partitionByDefinition(candidates: CandidateEvidence[]): Partition {
  const unreadable: CandidateEvidence[] = [];
  const classes: DefinitionClass[] = [];

  for (const c of candidates) {
    if (fingerprint(c.entity).grainKeys.length === 0) {
      unreadable.push(c);
      continue;
    }
    let placed = false;
    for (const cls of classes) {
      const verdicts = cls.members.map((m) => compatible(c, m));
      if (verdicts.every((v) => v.compatible)) {
        cls.members.push(c);
        placed = true;
        break;
      }
    }
    if (!placed) {
      classes.push({ id: `class-${classes.length + 1}`, members: [c], separatedBy: [] });
    }
  }

  // Record, for each class after the first, what separates it from class 1.
  for (let i = 1; i < classes.length; i++) {
    const cls = classes[i];
    const first = classes[0];
    if (!cls || !first) continue;
    const head = cls.members[0];
    const other = first.members[0];
    if (head && other) cls.separatedBy.push(compatible(head, other).reason);
  }

  return { classes, unreadable };
}

/**
 * A class is "standing" when at least one member is something a team would
 * defend: currently maintained, owned, and documented. Two standing classes
 * mean two live definitions, which is the ABSTAIN case. A class whose only
 * members are stale, unowned or undocumented is debris, not a rival definition.
 */
export function isStanding(cls: DefinitionClass, staleDays: number): boolean {
  return cls.members.some(
    (m) =>
      !m.entity.deprecation?.deprecated &&
      (m.stalenessDays === null || m.stalenessDays <= staleDays) &&
      m.entity.owners.length > 0 &&
      Boolean(m.entity.description),
  );
}
