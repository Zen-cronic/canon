// The two judgment calls. Everything else in canon is graph traversal.
//
// 1. Triage  — with 250+ entities and 20 name matches, deciding which handful
//              deserve a real look is itself the agentic act.
// 2. Ruling  — weighing conflicting evidence into a verdict, including the
//              decision to ABSTAIN when the graph genuinely does not separate
//              the candidates.

import type { SearchHit, Urn } from "../datahub/types.ts";
import { dossier, searchSummary } from "./investigate.ts";
import { askJson } from "./llm.ts";
import type { CandidateEvidence, Ruling, Triage } from "./types.ts";

const TRIAGE_SYSTEM = `You are the triage step of canon, an agent that decides which asset in a data catalog is the canonical source for a given question.

You are looking at raw search hits from DataHub — name, platform, entity type and the search engine's own relevance score. Nothing else has been fetched yet, because fetching full metadata for every hit is expensive.

Your job: choose the small set of candidates that plausibly answer the question and are worth a full investigation. Be decisive.

Rules:
- Shortlist between 2 and 7 URNs. Fewer is better if the rest are obviously irrelevant.
- A high search score is NOT evidence of correctness. Search ranks on name similarity and popularity, and both mislead — a raw operational table and a stale staging copy usually outrank the modelled table a person should actually use.
- Include the plausible traps, not only the plausible winner. canon has to explain why the wrong answers are wrong, so a shortlist of only good candidates is a failed triage.
- Substring collisions are common and usually irrelevant: "purchase_orders" is not "orders". Dismiss them explicitly.
- Include dashboards, explores and topics only if the question could genuinely be answered by one.
- Every dismissal needs a one-clause reason.`;

const TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    reasoning: { type: "string", description: "Two or three sentences on how you split the hits." },
    shortlist: { type: "array", items: { type: "string" }, description: "URNs worth investigating." },
    dismissed: {
      type: "array",
      items: {
        type: "object",
        properties: {
          urn: { type: "string" },
          because: { type: "string" },
        },
        required: ["urn", "because"],
        additionalProperties: false,
      },
    },
  },
  required: ["reasoning", "shortlist", "dismissed"],
  additionalProperties: false,
};

export async function triage(
  subject: string,
  question: string,
  hits: SearchHit[],
): Promise<{ triage: Triage; provenance: Awaited<ReturnType<typeof askJson>>["provenance"] }> {
  const { value, provenance } = await askJson<Triage>({
    subject,
    phase: "triage",
    system: TRIAGE_SYSTEM,
    prompt: `Question from a data consumer: "${question}"\n\nDataHub search returned these hits:\n\n${searchSummary(hits)}`,
    schema: TRIAGE_SCHEMA,
  });
  return { triage: value, provenance };
}

const RULING_SYSTEM = `You are the adjudication step of canon. You decide which asset in a data catalog is THE canonical source for a question, and you justify it from graph evidence only.

You will be given a dossier assembled from DataHub: for each candidate, its lineage position, freshness, row counts, ownership, documentation, tags, glossary terms, deprecation status, data-quality assertions, column schema, and who actually queries it.

How to weigh evidence — this is the whole job, so read it carefully:

- LINEAGE POSITION is the strongest signal, but it does not mean "most upstream". The raw operational table is upstream of everything and is almost never the right answer for analytics: rows mutate in place, business rules are unapplied, and it usually carries PII. The right answer is normally the modelled layer where business logic has been applied and nothing further derives from it for that purpose.
- FRESHNESS is a disqualifier, not a qualifier. A stale candidate is out. But "freshest" does not mean "correct" — an operational table written to seconds ago is fresher than every mart and is still the wrong answer.
- USAGE is social proof, and social proof is often just habit. A stale table that four analysts query every week is evidence of a live problem, not evidence that it is canonical. Say so.
- DBT SIBLINGS matter. When a dbt model and a warehouse table are siblings they are one logical asset: the dbt model is the definition, the warehouse table is the thing you can actually query. Name the dbt model as canonical and the warehouse materialization as what to query.
- DEPRECATION, failing assertions, absent owners and absent descriptions all count against a candidate. Passing assertions, a curated description, a named owner and a certified tag all count for it.
- GOVERNANCE outranks convenience. If a candidate carries PII or personal-data terms and a governed, consent-filtered alternative exists, the governed one is canonical for any use that leaves the security boundary — say why.

ABSTAIN when you should. If two candidates are both current, both owned, both documented and encode genuinely different business definitions, there is no catalog-derivable winner — that is an organizational decision, not a metadata one. Return outcome ABSTAIN, explain precisely what makes them differ, and list what evidence would settle it. Inventing a winner in that situation is the worst thing you can do: it launders a disagreement into a fact. An honest ABSTAIN is a correct answer.

Every trap you list must name the concrete consequence of picking it — the wrong number, the stale window, the governance exposure. "It is not canonical" is not a reason.

Write the rationale for an engineer who has to act on it. Lead with the decision. No preamble.`;

const RULING_SCHEMA = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: ["RESOLVED", "ABSTAIN"] },
    canonical: { type: "string", description: "URN of the canonical asset. Empty string when ABSTAIN." },
    queryThis: {
      type: "string",
      description:
        "URN of the asset to actually query, when it differs from the canonical one (e.g. the warehouse sibling of a dbt model). Empty string otherwise.",
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    rationale: { type: "string" },
    traps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          urn: { type: "string" },
          why: { type: "string", description: "The concrete consequence of using this one instead." },
          severity: { type: "string", enum: ["blocker", "warning"] },
        },
        required: ["urn", "why", "severity"],
        additionalProperties: false,
      },
    },
    missingEvidence: {
      type: "array",
      items: { type: "string" },
      description: "On ABSTAIN: what the catalog would need for a decision to be possible.",
    },
  },
  required: ["outcome", "canonical", "queryThis", "confidence", "rationale", "traps", "missingEvidence"],
  additionalProperties: false,
};

type RawRuling = {
  outcome: "RESOLVED" | "ABSTAIN";
  canonical: string;
  queryThis: string;
  confidence: "high" | "medium" | "low";
  rationale: string;
  traps: Array<{ urn: Urn; why: string; severity: "blocker" | "warning" }>;
  missingEvidence: string[];
};

export async function adjudicate(
  subject: string,
  question: string,
  evidence: CandidateEvidence[],
): Promise<Ruling> {
  const { value, provenance } = await askJson<RawRuling>({
    subject,
    phase: "ruling",
    system: RULING_SYSTEM,
    prompt: `Question from a data consumer: "${question}"\n\nEvidence gathered from the DataHub context graph:\n\n${dossier(evidence)}`,
    schema: RULING_SCHEMA,
  });

  return {
    subject,
    outcome: value.outcome,
    canonical: value.canonical || undefined,
    queryThis: value.queryThis || undefined,
    confidence: value.confidence,
    rationale: value.rationale,
    traps: value.traps,
    missingEvidence: value.missingEvidence.length ? value.missingEvidence : undefined,
    provenance,
  };
}
