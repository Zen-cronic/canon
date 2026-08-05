// The loop.
//
// resolve() asks the graph first. If canon has already ruled on this subject,
// the catalog answers — no model call, no investigation. That is the whole
// thesis: the agent's job is to not be needed twice.

import type { DataHubClient } from "../datahub/client.ts";
import { adjudicate, triage } from "./adjudicate.ts";
import { runBaselines, type BaselinePick } from "./baselines.ts";
import { gatherEvidence, TraceRecorder } from "./investigate.ts";
import { planWriteBack, applyWriteBack, shortUrn, type WritePlan, type WriteResult } from "./writeback.ts";
import type { CandidateEvidence, Resolution, Ruling } from "./types.ts";

export type ResolveOptions = {
  /** The subject key a ruling is stored under, e.g. "customer orders". */
  subject: string;
  /** The question as a human would ask it. */
  question: string;
  /** Search query passed to DataHub. Defaults to the subject. */
  searchQuery?: string;
  /** Skip the graph-first check to force a fresh investigation. */
  force?: boolean;
  /** Apply the write-back plan. Without this, canon plans but does not write. */
  approve?: boolean;
};

export type ResolveResult = Resolution & {
  baselines: BaselinePick[];
  plan?: WritePlan;
  write?: WriteResult;
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
        provenance: { source: "replay", model: "none", note: "Answered from the graph; no model was called." },
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

  // Triage — first judgment call.
  const tT0 = performance.now();
  const { triage: tri, provenance: triProv } = await triage(opts.subject, opts.question, search.hits);
  trace.step(
    "llm",
    "triage",
    `shortlisted ${tri.shortlist.length} of ${search.hits.length} hits, dismissed ${tri.dismissed.length}. ${tri.reasoning}`,
    round(performance.now() - tT0),
    { model: 1 },
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

  // Ruling — second judgment call.
  const tR0 = performance.now();
  const ruling = await adjudicate(opts.subject, opts.question, evidence);
  trace.step(
    "llm",
    "adjudicate",
    ruling.outcome === "ABSTAIN"
      ? `ABSTAIN — ${ruling.rationale.slice(0, 160)}`
      : `${shortUrn(ruling.canonical ?? "")} is canonical (${ruling.confidence} confidence), ${ruling.traps.length} traps identified`,
    round(performance.now() - tR0),
    { model: 1 },
  );

  // Plan the write-back. Applying it needs approval.
  const plan = planWriteBack(ruling, evidence, now);
  trace.step(
    "canon",
    "plan_writeback",
    `${plan.mutations.length} mutations + 1 Context Document planned, awaiting approval`,
    0,
  );

  let write: WriteResult | undefined;
  if (opts.approve) {
    const tW0 = performance.now();
    write = await applyWriteBack(client, plan, ruling);
    trace.step(
      "datahub",
      "apply_mutations",
      `${write.receipts.filter((r) => r.applied).length}/${write.receipts.length} writes applied via ${[...new Set(write.receipts.map((r) => r.via))].join(", ")}`,
      round(performance.now() - tW0),
      { reads: write.receipts.length },
    );
    trace.step(
      "canon",
      "verify_writeback",
      write.verification.ok ? `VERIFIED — ${write.verification.detail}` : `FAILED — ${write.verification.detail}`,
      0,
      { reads: 1 },
    );
  }

  return {
    subject: opts.subject,
    answeredBy: "agent",
    ruling,
    evidence,
    baselines,
    trace: trace.all(),
    totals: { ms: round(performance.now() - t0), modelCalls: trace.modelCalls, graphReads: trace.graphReads },
    plan,
    write: write,
    writeBack: write
      ? {
          receipts: write.receipts.map((r) => ({
            via: r.via,
            applied: r.applied,
            summary: describeMutation(r.mutation),
          })),
          documentTitle: write.document.title,
        }
      : undefined,
  };
}

function describeMutation(m: { kind: string } & Record<string, unknown>): string {
  switch (m.kind) {
    case "setStructuredProperty":
      return `set ${String(m["propertyUrn"]).split(":").pop()} on ${shortUrn(String(m["entity"]))}`;
    case "setDeprecation":
      return `deprecate ${shortUrn(String(m["entity"]))}`;
    case "addGlossaryTerm":
      return `add term to ${shortUrn(String(m["entity"]))}`;
    case "addTag":
      return `tag ${shortUrn(String(m["entity"]))}`;
    case "upsertDocument":
      return `publish Context Document`;
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
