import type { DatasetEntity, RecordedQuery, Urn } from "../datahub/types.ts";

/** One thing canon did, in order. This is the agency trace the demo renders. */
export type TraceStep = {
  n: number;
  actor: "canon" | "llm" | "datahub";
  action: string;
  detail: string;
  /** Milliseconds spent, for the "second ask is free" comparison. */
  ms: number;
  modelCalls: number;
  graphReads: number;
};

/** The LLM's triage decision: which of the search hits deserve a real look. */
export type Triage = {
  shortlist: Urn[];
  dismissed: Array<{ urn: Urn; because: string }>;
  reasoning: string;
};

/** Everything canon gathered about one candidate, from the graph only. */
export type CandidateEvidence = {
  entity: DatasetEntity;
  upstreamCount: number;
  downstreamCount: number;
  /** How many hops from a source with no upstreams. 0 = it is a source. */
  derivationDepth: number;
  stalenessDays: number | null;
  humanQueryCount: number;
  serviceQueryCount: number;
  queries: RecordedQuery[];
  /** Its DataHub sibling, if the dbt model and the warehouse table are one asset. */
  siblingOf?: Urn;
};

export type Ruling = {
  subject: string;
  /** ABSTAIN is a first-class outcome, not a failure. */
  outcome: "RESOLVED" | "ABSTAIN";
  canonical?: Urn;
  /** When the canonical asset is a dbt model, this is the thing you actually query. */
  queryThis?: Urn;
  confidence: "high" | "medium" | "low";
  rationale: string;
  traps: Array<{ urn: Urn; why: string; severity: "blocker" | "warning" }>;
  /** Populated on ABSTAIN: what the catalog would need for canon to decide. */
  missingEvidence?: string[];
  provenance: LlmProvenance;
};

export type LlmProvenance = {
  /** `live` = a real model call happened. `replay` = a committed fixture was read. */
  source: "live" | "replay";
  model: string;
  /** Set on replay so nothing can be mistaken for measured live output. */
  note?: string;
};

export type Resolution = {
  subject: string;
  /** `graph` means the catalog answered — no model call was needed. */
  answeredBy: "graph" | "agent";
  ruling: Ruling;
  evidence: CandidateEvidence[];
  trace: TraceStep[];
  totals: { ms: number; modelCalls: number; graphReads: number };
  writeBack?: {
    receipts: Array<{ via: string; applied: boolean; summary: string }>;
    documentTitle?: string;
  };
};
