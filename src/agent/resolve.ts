// The loop.
//
// resolve() asks the graph first. If canon has already ruled on this subject,
// the catalog answers — no model call, no investigation. That is the whole
// thesis: the agent's job is to not be needed twice.
//
// Order of operations, and which parts are deterministic:
//
//   1. graph-first check      deterministic  (one read)
//   2. search                 deterministic  (DataHub's own ranking)
//   3. triage                 deterministic, optionally narrowed by a model
//   4. evidence gathering     deterministic  (~20 aspect reads)
//   5. baselines              deterministic  (the heuristics canon must beat)
//   6. ADJUDICATION           deterministic  <- the ruling. No model, ever.
//   7. narration              a model writes up (6), or a template does
//   8. write-back planning    deterministic
//   9. apply                  only on explicit approval of the plan from (8)
//
// Step 9 takes the plan produced in this call rather than re-running the
// investigation, so what gets applied is what was approved.

import type { DataHubClient } from "../datahub/client.ts";
import { adjudicate } from "./score.ts";
import { narrate } from "./narrate.ts";
import { triage } from "./triage.ts";
import { runBaselines, type BaselinePick } from "./baselines.ts";
import { gatherEvidence, TraceRecorder } from "./investigate.ts";
import { planWriteBack, applyWriteBack, shortUrn, type WritePlan, type WriteResult } from "./writeback.ts";
import type { Adjudication, CandidateEvidence, Resolution, Ruling } from "./types.ts";

export type ResolveOptions = {
  /** The subject key a ruling is stored under, e.g. "customer orders". */
  subject: string;
  /** The question as a human would ask it. */
  question: string;
  /** Search query passed to DataHub. Defaults to the subject. */
  searchQuery?: string;
  /** Skip the graph-first check to force a fresh investigation. */
  force?: boolean;
  /** Apply the write-back plan produced by THIS call. */
  approve?: boolean;
};

export type ResolveResult = Resolution & {
  baselines: BaselinePick[];
  plan?: WritePlan;
  write?: WriteResult;
  adjudication?: Adjudication;
};

export async function resolve(client: DataHubClient, opts: ResolveOptions): Promise<ResolveResult> {
  const trace = new TraceRecorder();
  const now = "now" in client && typeof client.now === "function" ? (client.now as () => number)() : Date.now();
  const t0 = performance.now();

  // Ask the graph first.
  if (!opts.force) {
    const tG0 = performance.now();
    const existing = await client.getCanonRuling(opts.subject);
    const tG = Math.round((performance.now() - tG0) * 100) / 100;
    if (existing) {
      trace.step(
        "datahub",
        "get_canon_ruling",
        `the catalog already answers "${opts.subject}": ${shortUrn(existing.canonicalUrn)}, ` +
          `decided by ${existing.decidedBy}. No investigation needed.`,
        tG,
        { reads: 1 },
      );
      const ruling: Ruling = {
        subject: opts.subject,
        outcome: "RESOLVED",
        canonical: existing.canonicalUrn,
        confidence: "high",
        rationale: existing.rationale,
        traps: existing.supersededUrns.map((u) => ({
          urn: u,
          why: "Superseded — recorded in the graph by a previous canon ruling.",
          severity: "warning" as const,
        })),
        mechanism: {
          verdict: "DUPLICATES",
          detail: "read back from the canon.* structured properties an earlier ruling wrote",
        },
        provenance: { source: "graph", model: "none", note: "Answered from the graph; nothing was recomputed." },
      };
      return {
        subject: opts.subject,
        answeredBy: "graph",
        ruling,
        evidence: [],
        baselines: [],
        trace: trace.all(),
        totals: { ms: round(performance.now() - t0), modelCalls: 0, graphReads: trace.graphReads },
      };
    }
    trace.step("datahub", "get_canon_ruling", `no prior ruling for "${opts.subject}" — investigating`, tG, {
      reads: 1,
    });
  }

  // Search.
  const query = opts.searchQuery ?? opts.subject;
  const tS0 = performance.now();
  const search = await client.search(query, { limit: 20 });
  trace.step(
    "datahub",
    "search",
    `"${query}" matched ${search.total} entities; took the top ${search.hits.length} by relevance`,
    round(performance.now() - tS0),
    { reads: 1 },
  );

  // Triage — structural, optionally narrowed by a model.
  const tT0 = performance.now();
  const { triage: tri, provenance: triProv } = await triage(opts.subject, opts.question, search.hits);
  trace.step(
    triProv.source === "live" ? "llm" : "canon",
    "triage",
    `shortlisted ${tri.shortlist.length} of ${tri.considered} hits, dismissed ${tri.dismissed.length}. ${tri.reasoning}`,
    round(performance.now() - tT0),
    { model: triProv.source === "live" ? 1 : 0 },
  );

  // Evidence.
  const evidence = await gatherEvidence(client, tri.shortlist, now, trace);

  // Baselines — what the naive strategies would have picked.
  const baselines = await runBaselines(client, query, evidence);
  trace.step(
    "canon",
    "baselines",
    baselines.map((b) => `${b.baseline} → ${b.pick ? shortUrn(b.pick) : "nothing"}`).join("; "),
    0,
  );

  // Adjudication — deterministic. This is the decision.
  const tA0 = performance.now();
  const adjudication = adjudicate(opts.subject, evidence, now);
  trace.step(
    "canon",
    "adjudicate",
    `${adjudication.ruling.mechanism.verdict}: ${adjudication.ruling.mechanism.detail}. ` +
      (adjudication.ruling.outcome === "ABSTAIN"
        ? "ABSTAIN — no catalog-derivable winner."
        : `${shortUrn(adjudication.ruling.canonical ?? "")} wins on ${adjudication.scores[0]?.total} points ` +
          `(${adjudication.scores[0]?.hits.length} rules fired), ${adjudication.ruling.traps.length} traps identified.`),
    round(performance.now() - tA0),
  );

  // Narration — prose only. Cannot change the ruling above.
  const tN0 = performance.now();
  const ruling = await narrate(adjudication, evidence);
  trace.step(
    ruling.narration?.source === "live" ? "llm" : "canon",
    "narrate",
    ruling.narration?.source === "live"
      ? `rationale written up by ${ruling.narration.model}; the decision is unchanged`
      : "rationale generated from the rule table (no model configured)",
    round(performance.now() - tN0),
    { model: ruling.narration?.source === "live" ? 1 : 0 },
  );

  // Plan the write-back. Applying it needs approval.
  const plan = planWriteBack(ruling, evidence, now);
  trace.step(
    "canon",
    "plan_writeback",
    `${plan.mutations.length} mutations + 1 Document planned, awaiting approval`,
    0,
  );

  const result: ResolveResult = {
    subject: opts.subject,
    answeredBy: "agent",
    ruling,
    evidence,
    baselines,
    adjudication,
    trace: trace.all(),
    totals: { ms: round(performance.now() - t0), modelCalls: trace.modelCalls, graphReads: trace.graphReads },
    plan,
  };

  if (opts.approve) {
    await applyApproved(client, result);
  }

  return result;
}

/**
 * Applies the plan this result already produced, and records the outcome on it.
 *
 * Kept separate so the approval gate is real: the caller shows `result.plan` to
 * a human, and if they say yes, THAT plan is what lands. Nothing re-investigates
 * between the showing and the applying, so the applied plan cannot differ from
 * the displayed one.
 */
export async function applyApproved(client: DataHubClient, result: ResolveResult): Promise<WriteResult> {
  if (!result.plan) throw new Error("no plan on this result — nothing to approve");

  const trace = new TraceRecorder();
  const t0 = performance.now();
  const write = await applyWriteBack(client, result.plan, result.ruling);
  const applied = write.receipts.filter((r) => r.applied).length;

  trace.step(
    "datahub",
    "apply_mutations",
    `${applied}/${write.receipts.length} writes applied via ${[...new Set(write.receipts.map((r) => r.via))].join(", ")}`,
    round(performance.now() - t0),
    { reads: write.receipts.length },
  );
  trace.step(
    "canon",
    "verify_writeback",
    write.verification.ok ? `VERIFIED — ${write.verification.detail}` : `FAILED — ${write.verification.detail}`,
    0,
    { reads: 1 },
  );

  const offset = result.trace.length;
  result.trace.push(...trace.all().map((s) => ({ ...s, n: s.n + offset })));
  result.totals.graphReads += trace.graphReads;
  result.write = write;
  result.writeBack = {
    receipts: write.receipts.map((r) => ({
      via: r.via,
      applied: r.applied,
      summary: describeMutation(r.mutation),
    })),
    documentTitle: write.document.title,
  };
  return write;
}

function describeMutation(m: { kind: string } & Record<string, unknown>): string {
  switch (m.kind) {
    case "setStructuredProperty":
      return `set ${String(m["propertyUrn"]).split(":").pop()} on ${shortUrn(String(m["entity"]))}`;
    case "removeStructuredProperty":
      return `retract canon ruling on ${shortUrn(String(m["entity"]))}`;
    case "setDeprecation":
      return `deprecate ${shortUrn(String(m["entity"]))}`;
    case "addGlossaryTerm":
      return `add term to ${shortUrn(String(m["entity"]))}`;
    case "addTag":
      return `tag ${shortUrn(String(m["entity"]))}`;
    case "upsertDocument":
      return `publish Document`;
    case "createProposal":
      return `open question on ${shortUrn(String(m["entity"]))}`;
    default:
      return m.kind;
  }
}

function round(ms: number): number {
  return Math.round(ms * 100) / 100;
}

export type { CandidateEvidence };
