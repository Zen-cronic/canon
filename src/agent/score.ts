// Adjudication. Deterministic, and that is the point.
//
// Given the same catalog, this returns the same ruling every time — no model
// call, no fixture, no randomness. Three things depend on that:
//
//   * `npm run poison` can change the catalog and show the ruling move, on
//     camera, the same way in every take.
//   * `npm run eval` can score the adjudicator over scenarios that were
//     generated rather than hand-written.
//   * A judge can edit fixtures/catalog.json and watch the answer change.
//
// The language model's job is downstream of this file: it writes the ruling up
// in prose. It never picks the winner. See src/agent/narrate.ts.

import type { Urn } from "../datahub/types.ts";
import { isStanding, partitionByDefinition, type DefinitionClass } from "./cohort.ts";
import { RULES, THRESHOLDS, describeAge, shortName, type RuleHit } from "./rules.ts";
import type { CandidateEvidence, CandidateScore, Adjudication, Ruling } from "./types.ts";

export function scoreCandidate(c: CandidateEvidence, cohort: CandidateEvidence[], now: number): RuleHit[] {
  const ctx = { cohort, now };
  const hits: RuleHit[] = [];
  for (const rule of RULES) {
    const h = rule.apply(c, ctx);
    if (h) hits.push(h);
  }
  return hits;
}

function total(hits: RuleHit[]): number {
  return hits.reduce((s, h) => s + h.delta, 0);
}

/**
 * Which candidates may be deprecated.
 *
 * Deliberately narrow. Deprecating a table is a claim other humans and agents
 * will act on, and writing it onto the wrong asset is worse than writing
 * nothing: deprecating the operational source tells the checkout service it is
 * obsolete, and deprecating a rival definition settles an argument that is not
 * ours to settle. So the only thing canon will ever deprecate is a landing copy
 * that is demonstrably dead:
 *
 *   1. reached by a COPY edge — a copy of something else, not an original;
 *   2. stale past the window, or carrying a failing freshness assertion;
 *   3. no business owner to consult;
 *   4. every asset that reads it DIRECTLY is inside this same definition class,
 *      so nothing outside the question depends on it. Direct, not transitive:
 *      a dashboard further down the graph reads through the canonical model,
 *      which is precisely why retiring the copy is safe;
 *   5. it has upstreams, so it is not the system of record; and
 *   6. it is not already deprecated.
 *
 * Everything else that loses gets a question-scoped structured property and a
 * warning, which says "not this one, for this question" without asserting
 * anything about the asset in general.
 */
export function isTrulyDead(c: CandidateEvidence, cohort: CandidateEvidence[]): boolean {
  const cohortUrns = new Set(cohort.map((x) => x.entity.urn));
  const isCopy = c.entity.upstreams.some((u) => u.type === "COPY");
  const failingFreshness = (c.entity.assertions ?? []).some(
    (a) => a.type === "FRESHNESS" && (a.lastResult === "FAILURE" || a.lastResult === "ERROR"),
  );
  const stale = c.stalenessDays !== null && c.stalenessDays > THRESHOLDS.staleDays;
  const hasBusinessOwner = c.entity.owners.some((o) => o.type === "BUSINESS_OWNER");
  const externalConsumers = c.directDownstreamUrns.filter((u) => !cohortUrns.has(u));

  return (
    isCopy &&
    (stale || failingFreshness) &&
    !hasBusinessOwner &&
    externalConsumers.length === 0 &&
    c.entity.upstreams.length > 0 &&
    !c.entity.deprecation?.deprecated
  );
}

/** The single sharpest negative fact about a candidate, for the trap line. */
function worstHit(hits: RuleHit[]): RuleHit | null {
  const negatives = hits.filter((h) => h.delta < 0).sort((a, b) => a.delta - b.delta);
  return negatives[0] ?? null;
}

function trapReason(c: CandidateEvidence, hits: RuleHit[], winner: CandidateEvidence): string {
  const worst = worstHit(hits);
  const gap = c.stalenessDays !== null && c.stalenessDays > THRESHOLDS.staleDays;
  const parts: string[] = [];
  if (worst) parts.push(worst.because);
  if (gap && worst?.rule !== "freshness.stale") {
    parts.push(`last written ${describeAge(c.stalenessDays)}`);
  }
  const rowDelta =
    c.entity.profile && winner.entity.profile
      ? winner.entity.profile.rowCount - c.entity.profile.rowCount
      : null;
  if (rowDelta !== null && Math.abs(rowDelta) > 0) {
    parts.push(
      `${Math.abs(rowDelta).toLocaleString()} rows ${rowDelta > 0 ? "short of" : "beyond"} ${shortName(winner.entity.urn)}`,
    );
  }
  return parts.length ? parts.join("; ") : "scored below the canonical asset on every weighted rule";
}

function pickClass(classes: DefinitionClass[], now: number): DefinitionClass | null {
  // The subject class is the one with the strongest single member. Using the
  // best member rather than the biggest class stops a pile of debris copies
  // from outvoting one well-governed definition.
  let best: { cls: DefinitionClass; score: number } | null = null;
  for (const cls of classes) {
    const s = Math.max(...cls.members.map((m) => total(scoreCandidate(m, cls.members, now))));
    if (!best || s > best.score) best = { cls, score: s };
  }
  return best?.cls ?? null;
}

export function adjudicate(
  subject: string,
  candidates: CandidateEvidence[],
  now: number,
): Adjudication {
  const partition = partitionByDefinition(candidates);
  const partitionView = {
    classes: partition.classes.map((c) => ({
      id: c.id,
      members: c.members.map((m) => m.entity.urn),
      separatedBy: c.separatedBy,
    })),
    unreadable: partition.unreadable.map((m) => m.entity.urn),
  };

  const base = {
    subject,
    confidence: "low" as const,
    traps: [],
    provenance: { source: "computed" as const, model: "none" as const, note: RULES_NOTE },
  };

  if (partition.classes.length === 0) {
    return {
      ruling: {
        ...base,
        outcome: "ABSTAIN",
        rationale: `No candidate for "${subject}" declares a readable schema, so canon cannot establish what any of them measures.`,
        missingEvidence: ["schemaMetadata on at least two candidates"],
        mechanism: { verdict: "NO_CANDIDATES", detail: "no candidate had a readable grain" },
      },
      scores: [],
      partition: partitionView,
      abstainCause: "NO_CANDIDATES",
    };
  }

  // ABSTAIN case 1 — two live definitions. This is the branch that must not be
  // talked out of itself: if two classes each contain something current, owned
  // and documented, the disagreement is about what the business means, and no
  // metadata settles that.
  const standing = partition.classes.filter((c) => isStanding(c, THRESHOLDS.staleDays));
  if (standing.length > 1) {
    const [a, b] = standing;
    const reason = b?.separatedBy[0] ?? "they measure different things";
    const naming = standing
      .map((c) => {
        const head = c.members[0];
        return head ? `${shortName(head.entity.urn)} (${head.entity.description ?? "no description"})` : c.id;
      })
      .join("  ·  ");
    return {
      ruling: {
        ...base,
        outcome: "ABSTAIN",
        rationale:
          `Two definitions of "${subject}" are both live, both owned and both documented — ${reason}. ` +
          `${naming}. Neither is stale, deprecated or untested, so no catalog signal separates them. ` +
          `Choosing one would settle a business disagreement by writing metadata, which is the one thing canon will not do.`,
        missingEvidence: [
          `a business owner's decision on which definition of "${subject}" is reported externally`,
          "a glossary term that names the reported metric and is attached to exactly one of them",
          "a documented policy for which definition the board pack uses",
        ],
        mechanism: {
          verdict: "COMPETING_DEFINITIONS",
          detail: reason,
        },
      },
      scores: standing.flatMap((cls) =>
        cls.members.map((m, i) => {
          const hits = scoreCandidate(m, cls.members, now);
          return { urn: m.entity.urn, classId: cls.id, total: total(hits), hits, rank: i + 1 };
        }),
      ),
      partition: partitionView,
      abstainCause: "COMPETING_DEFINITIONS",
    };
  }

  const cls = pickClass(partition.classes, now);
  if (!cls) throw new Error("partition produced classes but none could be selected");

  const scored = cls.members
    .map((m) => {
      const hits = scoreCandidate(m, cls.members, now);
      return { urn: m.entity.urn, classId: cls.id, total: total(hits), hits, rank: 0, evidence: m };
    })
    .sort((a, b) => b.total - a.total)
    .map((s, i) => ({ ...s, rank: i + 1 }));

  const first = scored[0];
  const second = scored[1];
  if (!first) throw new Error("selected class has no members");

  const margin = second ? first.total - second.total : Number.POSITIVE_INFINITY;

  // ABSTAIN case 2 — the evidence is there but it does not separate them.
  if (second && margin < THRESHOLDS.decisiveMargin) {
    return {
      ruling: {
        ...base,
        outcome: "ABSTAIN",
        rationale:
          `${shortName(first.urn)} and ${shortName(second.urn)} are the same fact measured twice, but they score ` +
          `${first.total} and ${second.total} — a ${margin}-point gap against a ${THRESHOLDS.decisiveMargin}-point ` +
          `threshold. The graph does not separate them, so canon declines to pick.`,
        missingEvidence: [
          "a data-quality assertion on either candidate",
          "a named owner on either candidate",
          "a Certified tag, or a deprecation on whichever is retired",
        ],
        mechanism: {
          verdict: "INSUFFICIENT_SEPARATION",
          detail: `top-two margin ${margin} < ${THRESHOLDS.decisiveMargin}`,
        },
      },
      scores: scored.map(({ evidence: _e, ...s }) => s),
      partition: partitionView,
      abstainCause: "INSUFFICIENT_SEPARATION",
    };
  }

  // RESOLVED. If the winner is a dbt model with a warehouse sibling, the model
  // is the definition and the sibling is the thing you can actually query.
  const winner = first.evidence;
  const sibling = winner.siblingOf
    ? cls.members.find((m) => m.entity.urn === winner.siblingOf)
    : undefined;
  const queryThis = winner.entity.platform === "dbt" && sibling ? sibling.entity.urn : undefined;

  const traps = scored
    .slice(1)
    .filter((s) => s.urn !== queryThis)
    .map((s) => ({
      urn: s.urn,
      why: trapReason(s.evidence, s.hits, winner),
      severity: isTrulyDead(s.evidence, cls.members) ? ("blocker" as const) : ("warning" as const),
      score: s.total,
    }));

  const confidence: Ruling["confidence"] =
    margin >= THRESHOLDS.confidentMargin ? "high" : margin >= THRESHOLDS.decisiveMargin ? "medium" : "low";

  const topReasons = first.hits
    .filter((h) => h.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3)
    .map((h) => h.because);

  const rationale =
    `${shortName(first.urn)} is canonical for "${subject}", scoring ${first.total} against ` +
    `${second ? `${shortName(second.urn)} at ${second.total}` : "no rival"} — a ${margin === Number.POSITIVE_INFINITY ? "clear" : margin} point margin. ` +
    `It wins on ${topReasons.join("; ")}. ` +
    (queryThis
      ? `It is a dbt model, so it is the definition — query its DataHub sibling ${shortName(queryThis)}. `
      : "") +
    `${traps.length} other candidate${traps.length === 1 ? "" : "s"} answer to the same name and ${traps.length === 1 ? "is" : "are"} not it.`;

  return {
    ruling: {
      ...base,
      outcome: "RESOLVED",
      canonical: first.urn,
      queryThis,
      confidence,
      rationale,
      traps,
      mechanism: {
        verdict: "DUPLICATES",
        detail:
          `${cls.members.length} candidates share a grain and compatible measure semantics, ` +
          `so exactly one of them should be cited`,
      },
    },
    scores: scored.map(({ evidence: _e, ...s }) => s),
    partition: partitionView,
  };
}

export const RULES_NOTE =
  "Computed by the weighted rule table in src/agent/rules.ts. No model call is involved in the decision; " +
  "the same catalog always produces the same ruling.";

export type { Urn };
