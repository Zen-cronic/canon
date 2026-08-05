// The model seam.
//
// There is exactly one path here and it is a real API call. There is no fixture
// replay, because there is nothing left for a fixture to stand in for: the
// ruling is computed by the weighted rule table in src/agent/rules.ts, so the
// model only ever writes prose and narrows an already-computed shortlist. When
// no key is present, callers fall back to deterministic text and label it
// `source: "template"`.
//
// That is a deliberate reversal of how this started. An earlier version replayed
// the RULING itself from a subject-keyed fixture, which meant poisoning the
// catalog changed nothing about the answer — the gathered evidence never reached
// the verdict. Deleting the replay path was the fix, and the fixtures with it.

import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvenance } from "./types.ts";

export const MODEL = process.env.CANON_MODEL ?? "claude-opus-5";

export type LlmResult<T> = {
  value: T;
  provenance: LlmProvenance;
};

/** True when a live call is both possible and not switched off. */
export function liveAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) && process.env.CANON_LLM !== "off";
}

/** Why the model path is or is not active, in one line for the CLI banner. */
export function llmStatus(): string {
  if (process.env.CANON_LLM === "off") return "off (CANON_LLM=off) — deterministic prose";
  if (!process.env.ANTHROPIC_API_KEY) return "not configured (no ANTHROPIC_API_KEY) — deterministic prose";
  return `live (${MODEL})`;
}

/** Asks the model for a JSON object matching `schema`. Live path only. */
export async function askJson<T>(opts: {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<LlmResult<T>> {
  if (!liveAvailable()) {
    throw new Error("askJson called with no ANTHROPIC_API_KEY. Callers must check liveAvailable() first.");
  }

  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 8000,
    system: opts.system,
    output_config: {
      format: { type: "json_schema", schema: opts.schema },
      effort: "high",
    },
    messages: [{ role: "user", content: opts.prompt }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Model declined the request (stop_reason=refusal).");
  }
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error(`Model returned no text block (stop_reason=${response.stop_reason}).`);
  }
  return {
    value: JSON.parse(text.text) as T,
    provenance: { source: "live", model: response.model },
  };
}
