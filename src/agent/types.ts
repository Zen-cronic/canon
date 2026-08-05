import type { DatasetEntity, RecordedQuery, Urn } from "../datahub/types.ts";
import type { RuleHit } from "./rules.ts";

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
  /** Every downstream URN within the lineage walk, at any depth. */
  downstreamUrns: Urn[];
  /**
   * Downstream neighbours at hop 1 only — the assets that read this one
   * DIRECTLY. The deprecation guard uses these, not the transitive set: a
   * dashboard four hops down reads through the canonical model, so it is not a
   * reason to keep a dead landing copy alive.
   */
  directDownstreamUrns: Urn[];
  upstreamUrns: Urn[];
};

/** One candidate's arithmetic: every rule that fired, and the total. */
export type CandidateScore = {
  urn: Urn;
  classId: string;
  total: number;
  hits: RuleHit[];
  /** 1 = highest scoring in its definition class. */
  rank: number;
};

/** Why canon could or could not rule — the mechanism, named. */
export type RulingMechanism = {
  verdict: "DUPLICATES" | "COMPETING_DEFINITIONS" | "INSUFFICIENT_SEPARATION" | "NO_CANDIDATES";
  detail: string;
};

/** Everything the deterministic adjudicator produced, ruling included. */
export type Adjudication = {
  ruling: Ruling;
  scores: CandidateScore[];
  partition: {
    classes: Array<{ id: string; members: Urn[]; separatedBy: string[] }>;
    unreadable: Urn[];
  };
  abstainCause?: "COMPETING_DEFINITIONS" | "INSUFFICIENT_SEPARATION" | "NO_CANDIDATES";
};

export type Ruling = {
  subject: string;
  /** ABSTAIN is a first-class outcome, not a failure. */
  outcome: "RESOLVED" | "ABSTAIN";
  canonical?: Urn;
  /** When the canonical asset is a dbt model, this is the thing you actually query. */
  queryThis?: Urn;
  confidence: "high" | "medium" | "low";
  /**
   * Computed by the rule table. When a model is available it is REWRITTEN in
   * prose by src/agent/narrate.ts — the words can change, the decision cannot.
   */
  rationale: string;
  /** Set when a model rewrote the rationale, so the computed original stays visible. */
  computedRationale?: string;
  traps: Array<{ urn: Urn; why: string; severity: "blocker" | "warning"; score?: number }>;
  /** Populated on ABSTAIN: what the catalog would need for canon to decide. */
  missingEvidence?: string[];
  /** Which branch of the duplicate-vs-different-definition test produced this. */
  mechanism: RulingMechanism;
  provenance: RulingProvenance;
  /** Provenance of the prose only. Absent when nothing rewrote it. */
  narration?: LlmProvenance;
};

/**
 * How the DECISION was reached. `computed` is the only value the shipped path
 * ever produces — the rule table decides, always. It exists as a field so the
 * report can state it rather than the README having to assert it.
 */
export type RulingProvenance = {
  source: "computed" | "graph";
  model: "none";
  note?: string;
};

export type LlmProvenance = {
  /** `live` = a real model call happened. `template` = deterministic prose, no model. */
  source: "live" | "template";
  model: string;
  /** Set on the template path so nothing can be mistaken for model output. */
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
