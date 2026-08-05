// Which of the search hits deserve a full investigation.
//
// With 257 entities and 20 name matches for "orders", fetching every aspect of
// every hit is the expensive part of the job, so something has to choose. That
// choice is deterministic here, for the same reason the ruling is: a demo that
// has to reproduce across takes cannot have a coin-flip in the middle of it.
//
// The one genuinely hard call is the substring collision. `stg_orders` is the
// orders table at the staging layer. `purchase_orders` is a different noun that
// happens to end in the same word. Telling those apart is done structurally —
// by looking at what token sits in front of the subject token, and whether it
// is a known warehouse layer prefix or a qualifier that changes the meaning.
//
// A model, when one is available, may narrow this shortlist further. It may
// never widen it, and every URN it returns is checked against the search result
// set before it is used — a shortlist that names an asset the search never
// returned is a bug, not a judgement call.

import type { SearchHit, Urn } from "../datahub/types.ts";
import { askJson, liveAvailable } from "./llm.ts";
import { searchSummary } from "./investigate.ts";
import type { LlmProvenance, Triage } from "./types.ts";

/** Warehouse layer prefixes and suffixes. These qualify a noun without changing it. */
const LAYER_AFFIXES = new Set([
  "stg", "staging", "raw", "src", "source", "landing",
  "int", "intermediate", "fct", "fact", "dim", "dimension",
  "mart", "marts", "agg", "rpt", "reporting", "vw", "view",
  "tmp", "temp", "bak", "backup", "snapshot", "hist", "history",
  "daily", "monthly", "weekly", "current", "latest", "final", "new", "old", "legacy", "explore",
]);

const STOP = new Set(["the", "a", "of", "for", "and", "my", "our", "all", "data", "table", "dataset"]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !STOP.has(t));
}

/** Trailing plural/singular fold, so `order` and `orders` are one token. */
function stem(t: string): string {
  return t.endsWith("ies") ? `${t.slice(0, -3)}y` : t.endsWith("s") && t.length > 3 ? t.slice(0, -1) : t;
}

export type TriageDecision = Triage & {
  /** Every hit considered, so the report can show what was rejected and why. */
  considered: number;
};

/**
 * Structural triage.
 *
 * A hit is shortlisted when the subject's head noun appears in its name and
 * every token adjacent to that noun is either a layer affix or part of the
 * subject itself. A hit is dismissed when some other qualifier binds to the
 * head noun, because that makes it a different thing with a similar name.
 */
export function triageStructurally(subject: string, hits: SearchHit[]): TriageDecision {
  const subjectTokens = tokenize(subject).map(stem);
  const head = subjectTokens[subjectTokens.length - 1];
  const shortlist: Urn[] = [];
  const dismissed: Array<{ urn: Urn; because: string }> = [];

  for (const hit of hits) {
    // Only the last path segment names the thing; the rest is database/schema.
    const leaf = hit.name.split(".").pop() ?? hit.name;
    const nameTokens = tokenize(leaf).map(stem);

    if (!head || !nameTokens.includes(head)) {
      dismissed.push({ urn: hit.urn, because: `"${leaf}" does not contain "${head ?? subject}"` });
      continue;
    }

    const idx = nameTokens.indexOf(head);
    const qualifier = idx > 0 ? nameTokens[idx - 1] : undefined;
    if (qualifier && !LAYER_AFFIXES.has(qualifier) && !subjectTokens.includes(qualifier)) {
      dismissed.push({
        urn: hit.urn,
        because: `"${qualifier}_${head}" is a different noun from "${head}" — the qualifier is not a warehouse layer`,
      });
      continue;
    }

    shortlist.push(hit.urn);
  }

  const reasoning =
    `Of ${hits.length} search hits, ${shortlist.length} name the same thing as "${subject}" once warehouse layer ` +
    `prefixes are discounted; ${dismissed.length} were dismissed, most because a qualifier binds to the head noun ` +
    `and makes it a different asset.`;

  return { shortlist, dismissed, reasoning, considered: hits.length };
}

const TRIAGE_SYSTEM = `You are the triage step of canon, an agent that decides which asset in a data catalog is the canonical source for a question.

A deterministic pass has already shortlisted candidates by name structure. Your only job is to REMOVE hits from that shortlist that a structural test cannot rule out but a reader obviously can — an asset that shares the noun but could not possibly answer the question.

Rules:
- You may only return URNs that appear in the shortlist you were given. Never add one.
- Keep the plausible traps. canon has to explain why the wrong answers are wrong, so removing every bad candidate is a failed triage.
- Keep at least two candidates. If you cannot justify removing anything, return the shortlist unchanged.
- Every removal needs a one-clause reason.`;

const TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    reasoning: { type: "string", description: "One or two sentences on what you removed and why." },
    keep: { type: "array", items: { type: "string" }, description: "URNs to keep. A subset of the input." },
    remove: {
      type: "array",
      items: {
        type: "object",
        properties: { urn: { type: "string" }, because: { type: "string" } },
        required: ["urn", "because"],
        additionalProperties: false,
      },
    },
  },
  required: ["reasoning", "keep", "remove"],
  additionalProperties: false,
};

export async function triage(
  subject: string,
  question: string,
  hits: SearchHit[],
): Promise<{ triage: TriageDecision; provenance: LlmProvenance }> {
  const structural = triageStructurally(subject, hits);

  if (!liveAvailable() || structural.shortlist.length < 3) {
    return {
      triage: structural,
      provenance: {
        source: "template",
        model: "none",
        note: "Structural triage only — no model call. Set ANTHROPIC_API_KEY to let a model narrow it further.",
      },
    };
  }

  const inScope = new Set(structural.shortlist);
  const shortlisted = hits.filter((h) => inScope.has(h.urn));
  const { value, provenance } = await askJson<{
    reasoning: string;
    keep: string[];
    remove: Array<{ urn: string; because: string }>;
  }>({
    system: TRIAGE_SYSTEM,
    prompt: `Question from a data consumer: "${question}"\n\nStructurally shortlisted candidates:\n\n${searchSummary(shortlisted)}`,
    schema: TRIAGE_SCHEMA,
  });

  // Constrain: the model may only narrow, and only within the hit set. Anything
  // it invents is dropped and counted, rather than silently trusted.
  const kept = value.keep.filter((u) => inScope.has(u));
  const invented = value.keep.filter((u) => !inScope.has(u));
  if (kept.length < 2) {
    return {
      triage: structural,
      provenance: {
        ...provenance,
        note: "Model tried to narrow below two candidates; structural shortlist kept instead.",
      },
    };
  }

  const removed = value.remove.filter((r) => inScope.has(r.urn) && !kept.includes(r.urn));
  return {
    triage: {
      shortlist: kept,
      dismissed: [...structural.dismissed, ...removed],
      reasoning: `${structural.reasoning} A model then narrowed it: ${value.reasoning}`,
      considered: hits.length,
    },
    provenance: invented.length
      ? { ...provenance, note: `${invented.length} model-proposed URN(s) were not in the search results and were dropped.` }
      : provenance,
  };
}
