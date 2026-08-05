// Evidence gathering: the deterministic middle of the agent.
//
// The LLM decides WHICH candidates deserve a look (triage) and WHAT the evidence
// means (adjudication). Everything in between is plain graph traversal, on
// purpose — a model should not be guessing at row counts it can read.

import type { DataHubClient } from "../datahub/client.ts";
import type { DatasetEntity, Urn } from "../datahub/types.ts";
import { isServiceActor } from "./baselines.ts";
import type { CandidateEvidence, TraceStep } from "./types.ts";

const DAY = 86_400_000;

export type Investigation = {
  searchTotal: number;
  candidates: CandidateEvidence[];
  trace: TraceStep[];
  graphReads: number;
};

export class TraceRecorder {
  private steps: TraceStep[] = [];
  private n = 0;
  graphReads = 0;
  modelCalls = 0;

  step(actor: TraceStep["actor"], action: string, detail: string, ms: number, opts: { model?: number; reads?: number } = {}): void {
    const model = opts.model ?? 0;
    const reads = opts.reads ?? 0;
    this.modelCalls += model;
    this.graphReads += reads;
    this.steps.push({ n: ++this.n, actor, action, detail, ms, modelCalls: model, graphReads: reads });
  }

  all(): TraceStep[] {
    return [...this.steps];
  }
}

/** Times an async call and returns both the value and the elapsed ms. */
async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = performance.now();
  const v = await fn();
  return [v, Math.round((performance.now() - t0) * 100) / 100];
}

export async function gatherEvidence(
  client: DataHubClient,
  urns: Urn[],
  now: number,
  trace: TraceRecorder,
): Promise<CandidateEvidence[]> {
  const [entities, tEnt] = await timed(() => client.getEntities(urns));
  trace.step(
    "datahub",
    "get_entities",
    `fetched ${entities.length} entities with schema, ownership, tags, deprecation, profile and usage aspects`,
    tEnt,
    { reads: 1 },
  );

  const out: CandidateEvidence[] = [];
  for (const entity of entities) {
    const [up, tUp] = await timed(() => client.getLineage(entity.urn, "UPSTREAM", 4));
    const [down, tDown] = await timed(() => client.getLineage(entity.urn, "DOWNSTREAM", 4));
    const [queries, tQ] = await timed(() => client.getDatasetQueries(entity.urn, { limit: 5 }));
    trace.step(
      "datahub",
      "get_lineage + get_dataset_queries",
      `${short(entity.name)}: ${up.nodes.length} upstream, ${down.nodes.length} downstream, ${queries.length} recorded queries`,
      Math.round((tUp + tDown + tQ) * 100) / 100,
      { reads: 3 },
    );

    let humanQueryCount = 0;
    let serviceQueryCount = 0;
    for (const q of queries) {
      const isService = q.actors.every(isServiceActor);
      if (isService) serviceQueryCount += q.runCount;
      else humanQueryCount += q.runCount;
    }
    // Usage stats cover queries the query-history aspect never captured. Split
    // them by the human/service composition of topUsers: a table with a million
    // queries from two pipeline accounts has no human adoption at all, and
    // counting those as human is what makes "most queried" such a bad heuristic.
    if (entity.usage && entity.usage.topUsers.length > 0) {
      const total = entity.usage.topUsers.length;
      const service = entity.usage.topUsers.filter(isServiceActor).length;
      const humanShare = (total - service) / total;
      humanQueryCount = Math.max(humanQueryCount, Math.round(entity.usage.totalSqlQueries * humanShare));
      serviceQueryCount = Math.max(
        serviceQueryCount,
        Math.round(entity.usage.totalSqlQueries * (service / total)),
      );
    }

    const lastWrite = entity.operation?.lastUpdatedTimestamp ?? entity.profile?.timestampMillis ?? null;

    out.push({
      entity,
      upstreamCount: up.nodes.length,
      downstreamCount: down.nodes.length,
      derivationDepth: maxHop(up.nodes),
      stalenessDays: lastWrite === null ? null : (now - lastWrite) / DAY,
      humanQueryCount,
      serviceQueryCount,
      queries,
      siblingOf: entity.siblings?.[0],
      // Kept as URNs, not just a count: the deprecation guard has to prove that
      // nothing OUTSIDE the question depends on a candidate before canon will
      // retire it, and a count cannot answer that.
      downstreamUrns: down.nodes.map((n) => n.urn),
      directDownstreamUrns: down.nodes.filter((n) => n.hop === 1).map((n) => n.urn),
      upstreamUrns: up.nodes.map((n) => n.urn),
    });
  }
  return out;
}

function maxHop(nodes: Array<{ hop: number }>): number {
  return nodes.reduce((m, n) => Math.max(m, n.hop), 0);
}

function short(name: string): string {
  const parts = name.split(".");
  return parts[parts.length - 1] ?? name;
}

/**
 * A compact, model-readable dossier. Deliberately lossy: this is what the
 * adjudicator sees, and keeping it small is what makes the reasoning auditable.
 */
export function dossier(candidates: CandidateEvidence[]): string {
  return candidates.map((c) => describeCandidate(c)).join("\n\n");
}

export function describeCandidate(c: CandidateEvidence): string {
  const e = c.entity;
  const lines: string[] = [];
  lines.push(`URN: ${e.urn}`);
  lines.push(`  platform=${e.platform} type=${e.subType} name=${e.name}`);
  if (e.description) lines.push(`  description${e.descriptionIsCurated ? " (curated)" : " (auto)"}: ${e.description}`);
  else lines.push("  description: NONE");
  lines.push(`  owners: ${e.owners.length ? e.owners.map((o) => `${o.owner} (${o.type})`).join(", ") : "NONE"}`);
  lines.push(`  tags: ${e.tags.join(", ") || "none"} | terms: ${e.glossaryTerms.join(", ") || "none"}`);
  if (e.deprecation?.deprecated) lines.push(`  DEPRECATED: ${e.deprecation.note ?? "(no note)"}`);
  lines.push(
    `  lineage: ${c.upstreamCount} upstream / ${c.downstreamCount} downstream, derivation depth ${c.derivationDepth}`,
  );
  if (e.upstreams.length) lines.push(`  derived from: ${e.upstreams.map((u) => `${u.dataset} [${u.type}]`).join(", ")}`);
  if (c.siblingOf) lines.push(`  DataHub sibling of: ${c.siblingOf} (same logical asset)`);
  lines.push(
    `  freshness: last written ${c.stalenessDays === null ? "unknown" : `${c.stalenessDays.toFixed(1)} days ago`}`,
  );
  if (e.profile) lines.push(`  profile: ${e.profile.rowCount.toLocaleString()} rows, ${e.profile.columnCount} columns`);
  lines.push(`  usage (30d): ${c.humanQueryCount} human queries, ${c.serviceQueryCount} service/pipeline queries`);
  if (e.assertions?.length) {
    lines.push(
      `  assertions: ${e.assertions.map((a) => `${a.type}=${a.lastResult} (${a.description})`).join("; ")}`,
    );
  } else {
    lines.push("  assertions: NONE");
  }
  if (e.schema.length) {
    lines.push(
      `  columns: ${e.schema
        .map((f) => `${f.fieldPath}:${f.nativeDataType}${f.glossaryTerms?.length ? ` [${f.glossaryTerms.join(",")}]` : ""}`)
        .join(", ")}`,
    );
  }
  for (const q of c.queries.slice(0, 2)) {
    lines.push(`  query seen ${q.runCount}x by ${q.actors.join(",")}: ${q.sql.replace(/\s+/g, " ").slice(0, 160)}`);
  }
  return lines.join("\n");
}

export function searchSummary(hits: Array<{ urn: Urn; name: string; platform: string; subType: string; score: number }>): string {
  return hits.map((h, i) => `${i + 1}. ${h.urn}\n   name=${h.name} platform=${h.platform} type=${h.subType} searchScore=${h.score}`).join("\n");
}

export function entityLabel(e: DatasetEntity): string {
  return `${e.platform}:${e.name}`;
}
