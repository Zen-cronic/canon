// Narration. The model writes it up; the model does not decide it.
//
// By the time anything here runs, the ruling already exists: a winner, a score
// per candidate, a reason per rule that fired, and a named mechanism verdict.
// This step turns that arithmetic into a sentence a person would say out loud.
//
// The contract is enforced, not merely intended:
//   * the model is given the decision and asked to explain it, never to review it
//   * only `rationale` and the `why` text on each trap can change
//   * the computed rationale is preserved on `computedRationale`, so both are
//     visible in the report and a judge can diff them
//   * with no key, the computed rationale IS the rationale and provenance says
//     `template`
//
// This is why the demo reproduces: the words may vary between runs, the ruling
// cannot.

import { askJson, liveAvailable } from "./llm.ts";
import { describeCandidate } from "./investigate.ts";
import { shortName } from "./rules.ts";
import type { Adjudication, CandidateEvidence, Ruling } from "./types.ts";

const NARRATE_SYSTEM = `You are the writing step of canon, an agent that decides which asset in a data catalog is the canonical source for a question.

THE DECISION HAS ALREADY BEEN MADE by a deterministic weighted rule table, and it is not yours to revisit. You are given the ruling, the score each candidate received, and every rule that fired with the evidence behind it. Your job is to write it up for the engineer who has to act on it in the next ten minutes.

Rules for the rationale:
- Lead with the decision. No preamble, no restating the question.
- Cite the specific numbers you were given — scores, row counts, days stale, assertion names, owner names. Never invent one.
- Explain why the runners-up lose in terms of consequence, not category. "Three days behind, so any total from it is missing three days of orders" — not "it is not canonical".
- If the ruling names a dbt model as canonical and a warehouse table as the thing to query, say why that is not a contradiction.
- If the outcome is ABSTAIN, do not talk yourself into a winner. Explain what makes the candidates genuinely different and what a human would have to decide. An honest abstention is a correct answer.
- Four sentences at most. This is read by someone about to send the number out.

Rules for each trap's "why":
- One clause, naming the concrete cost of using that asset instead: the wrong number, the missing window, the governance exposure.
- Keep the numbers you were given.

Write plainly. No metaphors, no "in conclusion", no bullet lists.`;

const NARRATE_SCHEMA = {
  type: "object",
  properties: {
    rationale: { type: "string", description: "At most four sentences explaining the ruling that was made." },
    traps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          urn: { type: "string" },
          why: { type: "string", description: "One clause naming the concrete cost of using this one instead." },
        },
        required: ["urn", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["rationale", "traps"],
  additionalProperties: false,
};

function decisionBrief(adj: Adjudication, evidence: CandidateEvidence[]): string {
  const r = adj.ruling;
  const lines: string[] = [];
  lines.push(`SUBJECT: ${r.subject}`);
  lines.push(`OUTCOME: ${r.outcome}${r.canonical ? ` — canonical is ${r.canonical}` : ""}`);
  if (r.queryThis) lines.push(`QUERY THIS INSTEAD (warehouse sibling): ${r.queryThis}`);
  lines.push(`CONFIDENCE: ${r.confidence}`);
  lines.push(`MECHANISM: ${r.mechanism.verdict} — ${r.mechanism.detail}`);
  lines.push("");
  lines.push("SCORES (computed, do not dispute):");
  for (const s of adj.scores) {
    lines.push(`  ${s.rank}. ${shortName(s.urn)} = ${s.total}`);
    for (const h of s.hits) {
      lines.push(`       ${h.delta > 0 ? "+" : ""}${h.delta}  ${h.rule}: ${h.because}`);
    }
  }
  if (r.missingEvidence?.length) {
    lines.push("");
    lines.push(`WHAT WOULD SETTLE IT: ${r.missingEvidence.join("; ")}`);
  }
  lines.push("");
  lines.push("FULL EVIDENCE:");
  lines.push(evidence.map(describeCandidate).join("\n\n"));
  return lines.join("\n");
}

/**
 * Rewrites the computed rationale in prose when a model is available. Returns
 * the ruling unchanged — decision, scores and severities included — when it is
 * not, or when the model call fails.
 */
export async function narrate(adj: Adjudication, evidence: CandidateEvidence[]): Promise<Ruling> {
  const computed = adj.ruling.rationale;

  if (!liveAvailable()) {
    return {
      ...adj.ruling,
      computedRationale: computed,
      narration: {
        source: "template",
        model: "none",
        note: "Prose generated from the rule table, not by a model. Set ANTHROPIC_API_KEY for a written-up rationale.",
      },
    };
  }

  try {
    const { value, provenance } = await askJson<{
      rationale: string;
      traps: Array<{ urn: string; why: string }>;
    }>({
      system: NARRATE_SYSTEM,
      prompt: decisionBrief(adj, evidence),
      schema: NARRATE_SCHEMA,
    });

    // Only the prose is taken. URNs, severities, scores and the outcome are the
    // rule table's, and a model reply that names an unknown URN is ignored
    // rather than merged.
    const byUrn = new Map(value.traps.map((t) => [t.urn, t.why]));
    return {
      ...adj.ruling,
      rationale: value.rationale.trim() || computed,
      computedRationale: computed,
      traps: adj.ruling.traps.map((t) => ({ ...t, why: byUrn.get(t.urn)?.trim() || t.why })),
      narration: provenance,
    };
  } catch (err) {
    return {
      ...adj.ruling,
      computedRationale: computed,
      narration: {
        source: "template",
        model: "none",
        note: `Model narration failed (${err instanceof Error ? err.message : String(err)}); computed rationale kept.`,
      },
    };
  }
}
