// Contributing the ruling back to the graph.
//
// Two rules this module exists to enforce:
//
//   1. Nothing is written without approval. canon PLANS mutations; applying them
//      is a separate, explicit call. Deprecating a table other people and agents
//      trust is consequential, and an agent that does it unprompted is not one a
//      data team would install.
//   2. Every write is verified by reading it back. After applying, canon
//      re-derives the ruling from the graph through the same read path a fresh
//      caller would use. If the round trip does not reproduce the ruling, the
//      write-back is reported as FAILED, not as done.

import type { DataHubClient, PersistedRuling } from "../datahub/client.ts";
import {
  CANON_DECIDED_AT_PROP,
  CANON_RATIONALE_PROP,
  CANON_STATUS_PROP,
  CANON_SUBJECT_PROP,
  CANON_SUPERSEDED_BY_PROP,
} from "../datahub/mock.ts";
import type { ContextDocument, Mutation, MutationReceipt } from "../datahub/types.ts";
import type { CandidateEvidence, Ruling } from "./types.ts";

export type WritePlan = {
  mutations: Mutation[];
  document: ContextDocument;
  /** Human-readable one-liners, for the approval prompt and the UI. */
  summary: string[];
};

export type WriteResult = {
  receipts: MutationReceipt[];
  document: ContextDocument;
  verification: {
    ok: boolean;
    detail: string;
    reread: PersistedRuling | null;
  };
};

const CANON_ACTOR = "urn:li:corpuser:canon";

export function planWriteBack(ruling: Ruling, evidence: CandidateEvidence[], now: number): WritePlan {
  const mutations: Mutation[] = [];
  const summary: string[] = [];

  if (ruling.outcome === "ABSTAIN") {
    // The negative case is still a contribution: the unanswerable question and
    // the evidence it needs go back to the owners as a proposal.
    const owners = [
      ...new Set(evidence.flatMap((c) => c.entity.owners.map((o) => o.owner))),
    ];
    const body = [
      `canon could not determine a canonical source for "${ruling.subject}" from catalog metadata alone.`,
      "",
      ruling.rationale,
      "",
      "What would settle it:",
      ...(ruling.missingEvidence ?? []).map((m) => `  - ${m}`),
      "",
      `Owners who can decide: ${owners.join(", ") || "none recorded"}`,
    ].join("\n");

    for (const c of evidence) {
      mutations.push({
        kind: "createProposal",
        entity: c.entity.urn,
        title: `Which asset is canonical for "${ruling.subject}"?`,
        body,
        // Named owners, read off the candidates. In live mode this becomes the
        // assignee list on a native DataHub Incident, so the question is routed
        // to people rather than broadcast.
        assignees: owners,
      });
    }
    summary.push(
      `File a native DataHub Incident on ${evidence.length} candidates, assigned to ` +
        `${owners.length ? owners.map((o) => o.split(":").pop()).join(", ") : "no recorded owner"} — ` +
        `canon abstained and will not invent a winner`,
    );

    const document: ContextDocument = {
      title: `canon: unresolved — ${ruling.subject}`,
      contents: body,
      relatedEntities: evidence.map((c) => c.entity.urn),
    };
    summary.push(`Publish the evidence trail as a Context Document`);
    return { mutations, document, summary };
  }

  const canonical = ruling.canonical;
  if (!canonical) throw new Error("RESOLVED ruling has no canonical URN");

  mutations.push(
    { kind: "setStructuredProperty", entity: canonical, propertyUrn: CANON_STATUS_PROP, values: ["canonical"] },
    { kind: "setStructuredProperty", entity: canonical, propertyUrn: CANON_SUBJECT_PROP, values: [ruling.subject] },
    { kind: "setStructuredProperty", entity: canonical, propertyUrn: CANON_DECIDED_AT_PROP, values: [now] },
    { kind: "setStructuredProperty", entity: canonical, propertyUrn: CANON_RATIONALE_PROP, values: [ruling.rationale] },
  );
  summary.push(`Mark ${shortUrn(canonical)} canonical for "${ruling.subject}" (structured properties)`);

  for (const trap of ruling.traps) {
    if (trap.urn === canonical) continue;
    mutations.push({
      kind: "setStructuredProperty",
      entity: trap.urn,
      propertyUrn: CANON_SUPERSEDED_BY_PROP,
      values: [canonical],
    });
    if (trap.severity === "blocker") {
      mutations.push({
        kind: "setDeprecation",
        entity: trap.urn,
        deprecated: true,
        note: `Not canonical for "${ruling.subject}". Use ${shortUrn(canonical)} instead. ${trap.why}`,
      });
      summary.push(`Deprecate ${shortUrn(trap.urn)} pointing at the winner — ${trap.why}`);
    } else {
      summary.push(`Mark ${shortUrn(trap.urn)} superseded (warning, no deprecation)`);
    }
  }

  const document: ContextDocument = {
    title: `canon: ${ruling.subject}`,
    contents: renderDocument(ruling, evidence),
    relatedEntities: [canonical, ...ruling.traps.map((t) => t.urn)],
  };
  summary.push("Publish the full evidence trail as a Context Document");

  return { mutations, document, summary };
}

/**
 * Applies the plan, then re-reads the ruling out of the graph to prove it landed.
 * The re-read goes through the ordinary client read path — the same one a fresh
 * caller would use — so a write that did not actually persist cannot pass.
 */
export async function applyWriteBack(
  client: DataHubClient,
  plan: WritePlan,
  ruling: Ruling,
): Promise<WriteResult> {
  const receipts = await client.applyMutations(plan.mutations);
  const docReceipt = await client.upsertDocument(plan.document);
  receipts.push(docReceipt);

  const verification = await verify(client, ruling);
  return { receipts, document: plan.document, verification };
}

async function verify(client: DataHubClient, ruling: Ruling): Promise<WriteResult["verification"]> {
  if (ruling.outcome === "ABSTAIN") {
    const reread = await client.getCanonRuling(ruling.subject);
    return reread === null
      ? { ok: true, detail: "Confirmed: no canonical claim was written for an abstained subject.", reread: null }
      : {
          ok: false,
          detail: `Expected no ruling in the graph after ABSTAIN, found ${reread.canonicalUrn}.`,
          reread,
        };
  }

  const reread = await client.getCanonRuling(ruling.subject);
  if (reread === null) {
    return { ok: false, detail: "Re-read found no canonical ruling in the graph.", reread: null };
  }
  if (reread.canonicalUrn !== ruling.canonical) {
    return {
      ok: false,
      detail: `Re-read returned ${reread.canonicalUrn}, expected ${ruling.canonical}.`,
      reread,
    };
  }
  const expectedSuperseded = ruling.traps.filter((t) => t.urn !== ruling.canonical).length;
  if (reread.supersededUrns.length !== expectedSuperseded) {
    return {
      ok: false,
      detail: `Re-read found ${reread.supersededUrns.length} superseded assets, expected ${expectedSuperseded}.`,
      reread,
    };
  }
  return {
    ok: true,
    detail: `Re-read from the graph reproduced the ruling: ${shortUrn(reread.canonicalUrn)} canonical, ${reread.supersededUrns.length} superseded.`,
    reread,
  };
}

function renderDocument(ruling: Ruling, evidence: CandidateEvidence[]): string {
  const lines: string[] = [];
  lines.push(`# Canonical source for "${ruling.subject}"`);
  lines.push("");
  lines.push(`**Use:** ${ruling.queryThis ?? ruling.canonical}`);
  if (ruling.queryThis && ruling.queryThis !== ruling.canonical) {
    lines.push(`**Defined by:** ${ruling.canonical}`);
  }
  lines.push(`**Confidence:** ${ruling.confidence}`);
  lines.push("");
  lines.push("## Why");
  lines.push(ruling.rationale);
  lines.push("");
  lines.push("## What not to use, and what happens if you do");
  for (const t of ruling.traps) {
    lines.push(`- **${shortUrn(t.urn)}** (${t.severity}) — ${t.why}`);
  }
  lines.push("");
  lines.push("## Evidence considered");
  for (const c of evidence) {
    const stale = c.stalenessDays === null ? "unknown" : `${c.stalenessDays.toFixed(1)}d`;
    lines.push(
      `- ${shortUrn(c.entity.urn)} — last written ${stale} ago, ${c.humanQueryCount} human queries/30d, ` +
        `${c.entity.owners.length} owners, ${c.entity.assertions?.length ?? 0} assertions` +
        (c.entity.deprecation?.deprecated ? ", DEPRECATED" : ""),
    );
  }
  lines.push("");
  lines.push(
    `_Written by canon (${ruling.provenance.source} model path, ${ruling.provenance.model}). ` +
      `Re-run canon to refresh; edit the canon.* structured properties to override._`,
  );
  if (ruling.provenance.note) {
    lines.push("");
    lines.push(`_${ruling.provenance.note}_`);
  }
  return lines.join("\n");
}

export function shortUrn(urn: string): string {
  const m = /urn:li:dataset:\(urn:li:dataPlatform:([^,]+),([^,]+),/.exec(urn);
  return m ? `${m[1]}:${m[2]}` : urn;
}

export { CANON_ACTOR };
