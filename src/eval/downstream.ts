// Does the catalog answer better after canon has written to it?
//
// The write-back claim is the one criterion-1 asks for directly, and until now
// this repo asserted it: `npm run ask-once` printed the catalog's new answer and
// invited you to agree it was better. This file measures it instead.
//
// The measurement runs three stock retrieval strategies over the same catalog
// before and after the ruling lands, and records two things: where the correct
// table ranks, and where the impostor ranks. No model is called on any path, so
// the numbers reproduce.
//
// Recording both is not padding. The first honest run of this file showed that
// a governance-aware client already ranks the right table first on this catalog,
// before canon does anything — the description, the owner and the Certified tag
// were enough. What the ruling changes is the other half: the staging copy that
// actually produced the wrong board number stops being served at all. A
// measurement that only tracked the winner would have reported "no change" and
// missed the entire effect.
//
// Three rules keep it honest:
//
//   1. NOTHING IN THIS FILE IMPORTS CANON. No rules, no scorer, no cohort, no
//      resolver. Everything below reads `search` and `getEntities` and nothing
//      else — the surface a stock MCP client has. If that import list ever
//      grows, the measurement stops meaning what it says.
//
//   2. GROUND TRUTH IS DECLARED, NOT ASKED FOR. The correct answer for each
//      question is fixed in DOWNSTREAM_QUESTIONS below, independently of what
//      canon rules. Scoring canon against its own output would measure nothing.
//
//   3. ONE QUESTION IS EXPECTED NOT TO MOVE. canon abstains on "daily revenue",
//      so it writes no canonical claim, so the ranking must come out identical.
//      A measurement where every number improves is a measurement with no
//      control in it.

import type { DataHubClient } from "../datahub/client.ts";
import type { DatasetEntity, Urn } from "../datahub/types.ts";

export type StrategyId = "top-hit" | "governance-aware" | "canonical-marker";

export type Offer = {
  urn: Urn;
  /** 1-based position among the things this strategy would actually offer. */
  rank: number | null;
  /** True when the strategy suppresses it — a deprecated asset is not an answer. */
  withheld: boolean;
  why: string;
};

export type StrategyResult = {
  strategy: StrategyId;
  describes: string;
  offers: Offer[];
  pick: Urn | null;
  /** 1-based rank of the best acceptable answer; null when it is never offered. */
  rankOfCorrect: number | null;
  /** Did the strategy's first suggestion happen to be right? */
  correctAtOne: boolean;
  /** How many candidates this strategy would put in front of a person at all. */
  offeredCount: number;
  /**
   * Where the known-bad table ranks — the one that actually put the wrong number
   * in the deck. `null` means the strategy no longer offers it, which is the
   * outcome that matters: on this catalog the right answer was already reachable,
   * and what changes after the ruling is that the wrong one stops being served.
   */
  trapRank: number | null;
};

export type DownstreamQuestion = {
  subject: string;
  question: string;
  /** What a stock client would type into `search`. */
  query: string;
  /**
   * The right answers, fixed here rather than read from a ruling. More than one
   * is allowed because DataHub siblings are one logical asset: the dbt model is
   * the definition and the warehouse table is the thing you put in a FROM
   * clause, and a client that offers either has answered the question.
   */
  acceptable: Urn[];
  /**
   * The wrong answer that actually caused the incident, named up front. Tracking
   * where this ranks is more informative than tracking the winner, because a
   * catalog with decent governance metadata often ranks the winner correctly
   * already — while still happily serving the impostor two rows below it.
   */
  trap?: Urn;
  /** Where the ground truth comes from, so it can be checked rather than trusted. */
  groundTruth: string;
  /** What the write-back is expected to do here. `unchanged` is the control. */
  expect: "improves" | "unchanged";
};

export type DownstreamDelta = {
  question: DownstreamQuestion;
  before: StrategyResult[];
  after: StrategyResult[];
};

/**
 * The questions, and the answers, fixed outside the adjudicator.
 *
 * `customer orders` — the correct pair is the same pair `bridge/price_delta.py`
 * runs its two SELECTs against to produce the published dollar figure. That
 * script does not import the rule table either, so the ground truth here and the
 * dollar figure in the README rest on the same independently-stated fact.
 *
 * `daily revenue` — deliberately has no right answer. Finance's recognised
 * revenue and Growth's gross bookings are different business facts sharing a
 * word, canon abstains, and this row exists to show the numbers can stay still.
 */
export const DOWNSTREAM_QUESTIONS: DownstreamQuestion[] = [
  {
    subject: "customer orders",
    question: "Where do I get customer orders?",
    query: "orders",
    acceptable: [
      "urn:li:dataset:(urn:li:dataPlatform:dbt,analytics.marts.fct_orders,PROD)",
      "urn:li:dataset:(urn:li:dataPlatform:snowflake,ANALYTICS.MARTS.FCT_ORDERS,PROD)",
    ],
    trap: "urn:li:dataset:(urn:li:dataPlatform:snowflake,ANALYTICS.STAGING.STG_ORDERS,PROD)",
    groundTruth:
      "the dbt model and its warehouse sibling — the pair bridge/price_delta.py queries for the published figure",
    expect: "improves",
  },
  {
    subject: "daily revenue",
    question: "What is our daily revenue?",
    query: "revenue",
    acceptable: [],
    groundTruth: "none — two different business facts share the word, so no ranking can be correct",
    expect: "unchanged",
  },
];

const CERTIFIED = /(^|:)certified$/i;

/**
 * The one convention this file assumes: a client looking for an explicit
 * canonical marker looks for a structured property whose value is the literal
 * string `canonical`, alongside one naming the subject it is canonical FOR.
 *
 * Deliberately matched by value rather than by property name, so the strategy
 * is not reading for `canon.*` specifically. Any tool writing that convention
 * would be picked up identically. It is still an assumption, and naming it here
 * is cheaper than being caught not having named it.
 */
function canonicalMarkerFor(entity: DatasetEntity, subject: string): boolean {
  const props = entity.structuredProperties ?? [];
  const claimsCanonical = props.some((p) => String(p.values[0]).toLowerCase() === "canonical");
  if (!claimsCanonical) return false;
  return props.some((p) => String(p.values[0]).trim().toLowerCase() === subject.trim().toLowerCase());
}

function isDeprecated(entity: DatasetEntity | undefined): boolean {
  return Boolean(entity?.deprecation?.deprecated);
}

/** What a governance-aware client can see without reading anything vendor-specific. */
function governanceScore(entity: DatasetEntity): { score: number; why: string[] } {
  const why: string[] = [];
  let score = 0;
  if (entity.descriptionIsCurated && entity.description) {
    score += 3;
    why.push("documented by a human");
  } else if (entity.description) {
    score += 1;
    why.push("has a harvested description");
  }
  if (entity.owners.length > 0) {
    score += 2;
    why.push("has an owner");
  }
  if (entity.tags.some((t) => CERTIFIED.test(t.split(":").pop() ?? t))) {
    score += 3;
    why.push("tagged Certified");
  }
  return { score, why };
}

/** Assigns 1..n to everything not withheld, leaving withheld offers unranked. */
function numbered(ordered: Array<Omit<Offer, "rank">>): Offer[] {
  let n = 0;
  return ordered.map((o) => ({ ...o, rank: o.withheld ? null : ++n }));
}

function finish(
  strategy: StrategyId,
  describes: string,
  offers: Offer[],
  q: DownstreamQuestion,
): StrategyResult {
  const live = offers.filter((o) => !o.withheld);
  const correct = live.find((o) => q.acceptable.includes(o.urn));
  const trap = q.trap ? live.find((o) => o.urn === q.trap) : undefined;
  return {
    strategy,
    describes,
    offers,
    pick: live[0]?.urn ?? null,
    rankOfCorrect: correct?.rank ?? null,
    correctAtOne: live[0] ? q.acceptable.includes(live[0].urn) : false,
    offeredCount: live.length,
    trapRank: trap?.rank ?? null,
  };
}

/**
 * Runs all three strategies over one question.
 *
 * Call it before the ruling and again after, against the same client, and the
 * difference is what canon's write-back did to everyone else's answer.
 */
export async function measure(
  client: DataHubClient,
  q: DownstreamQuestion,
  opts: { limit?: number } = {},
): Promise<StrategyResult[]> {
  const search = await client.search(q.query, { limit: opts.limit ?? 20 });
  const order = search.hits.map((h) => h.urn);
  const entities = await client.getEntities(order);
  const byUrn = new Map(entities.map((e) => [e.urn, e]));

  // 1. Take the first thing search returned. Reads no metadata at all, so
  //    write-back cannot help it — which is the point of including it.
  const topHit = numbered(
    order.map((urn, i) => ({
      urn,
      withheld: false,
      why: `search rank ${i + 1}`,
    })),
  );

  // 2. Demote what the catalog says is untrustworthy, prefer what it says is
  //    looked after. Knows nothing about canon, or about any adjudicator.
  const governance = numbered(
    order
      .map((urn, i) => {
        const e = byUrn.get(urn);
        if (!e) return { urn, i, score: -1, withheld: false, why: "not readable" };
        if (isDeprecated(e)) {
          return { urn, i, score: -1000, withheld: true, why: "deprecated — not offered" };
        }
        const { score, why } = governanceScore(e);
        return { urn, i, score, withheld: false, why: why.length ? why.join(", ") : "no governance signal" };
      })
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map(({ urn, withheld, why }) => ({ urn, withheld, why })),
  );

  // 3. Strategy 2, plus honouring an explicit canonical claim for this subject.
  const marked = numbered(
    order
      .map((urn, i) => {
        const e = byUrn.get(urn);
        if (!e) return { urn, i, score: -1, withheld: false, why: "not readable" };
        if (isDeprecated(e)) {
          return { urn, i, score: -1000, withheld: true, why: "deprecated — not offered" };
        }
        const { score, why } = governanceScore(e);
        if (canonicalMarkerFor(e, q.subject)) {
          return {
            urn,
            i,
            score: score + 100,
            withheld: false,
            why: `marked canonical for "${q.subject}"`,
          };
        }
        return { urn, i, score, withheld: false, why: why.length ? why.join(", ") : "no governance signal" };
      })
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map(({ urn, withheld, why }) => ({ urn, withheld, why })),
  );

  return [
    finish(
      "top-hit",
      "Takes whatever search returned first. Reads no metadata, so nothing written back can reach it.",
      topHit,
      q,
    ),
    finish(
      "governance-aware",
      "Suppresses deprecated assets and prefers documented, owned, certified ones. Knows nothing about canon.",
      governance,
      q,
    ),
    finish(
      "canonical-marker",
      "Governance-aware, and additionally honours an explicit canonical claim for the subject asked.",
      marked,
      q,
    ),
  ];
}

export type StrategySummary = {
  strategy: StrategyId;
  movements: Array<{
    subject: string;
    /** Rank of the correct answer, before and after. */
    before: number | null;
    after: number | null;
    /** Rank of the impostor. `null` after means it is no longer served. */
    trapBefore: number | null;
    trapAfter: number | null;
    offeredBefore: number;
    offeredAfter: number;
  }>;
  correctAtOneBefore: number;
  correctAtOneAfter: number;
  /** Questions where the impostor was served before the ruling. */
  trapServedBefore: number;
  /** Questions where it is still served after. This is the number that moved. */
  trapServedAfter: number;
  /** Questions with a declared right answer. The abstain control is excluded. */
  scored: number;
};

export function summarise(deltas: DownstreamDelta[]): StrategySummary[] {
  const ids: StrategyId[] = ["top-hit", "governance-aware", "canonical-marker"];
  const scored = deltas.filter((d) => d.question.acceptable.length > 0);

  return ids.map((id) => {
    const pick = (d: DownstreamDelta, side: "before" | "after") =>
      d[side].find((s) => s.strategy === id);
    const withTrap = scored.filter((d) => d.question.trap);

    return {
      strategy: id,
      movements: scored.map((d) => ({
        subject: d.question.subject,
        before: pick(d, "before")?.rankOfCorrect ?? null,
        after: pick(d, "after")?.rankOfCorrect ?? null,
        trapBefore: pick(d, "before")?.trapRank ?? null,
        trapAfter: pick(d, "after")?.trapRank ?? null,
        offeredBefore: pick(d, "before")?.offeredCount ?? 0,
        offeredAfter: pick(d, "after")?.offeredCount ?? 0,
      })),
      correctAtOneBefore: scored.filter((d) => pick(d, "before")?.correctAtOne).length,
      correctAtOneAfter: scored.filter((d) => pick(d, "after")?.correctAtOne).length,
      trapServedBefore: withTrap.filter((d) => pick(d, "before")?.trapRank !== null).length,
      trapServedAfter: withTrap.filter((d) => pick(d, "after")?.trapRank !== null).length,
      scored: scored.length,
    };
  });
}

/** True when a control question's ranking moved, which would invalidate the run. */
export function controlViolations(deltas: DownstreamDelta[]): string[] {
  const out: string[] = [];
  for (const d of deltas.filter((x) => x.question.expect === "unchanged")) {
    for (const before of d.before) {
      const after = d.after.find((s) => s.strategy === before.strategy);
      if (!after) continue;
      const b = before.offers.map((o) => `${o.urn}:${o.rank}`).join("|");
      const a = after.offers.map((o) => `${o.urn}:${o.rank}`).join("|");
      if (b !== a) {
        out.push(
          `${d.question.subject} / ${before.strategy}: ranking changed on a question canon abstained from`,
        );
      }
    }
  }
  return out;
}
