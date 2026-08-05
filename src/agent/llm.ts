// The model layer.
//
// Two paths, and the difference is always recorded on the ruling's provenance:
//   live   — a real Anthropic API call (needs ANTHROPIC_API_KEY)
//   replay — a committed fixture under fixtures/adjudications/
//
// Fixture adjudications were authored during development, NOT captured from a
// recorded API session. They exist so `npm run demo` works on a clean checkout
// with no credentials. Nothing in this repo may present a replayed ruling as
// measured live output; `provenance.note` carries that disclaimer into every
// rendered artifact.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvenance } from "./types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, "..", "..", "fixtures", "adjudications");

export const MODEL = process.env.CANON_MODEL ?? "claude-opus-5";

export const REPLAY_NOTE =
  "REPLAYED FIXTURE — authored during development, not captured from a live API call. " +
  "Set ANTHROPIC_API_KEY and CANON_LLM=live for a real model call.";

export function fixtureKey(subject: string): string {
  return subject
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export type LlmResult<T> = {
  value: T;
  provenance: LlmProvenance;
};

/** True when a live call is both requested and possible. */
export function liveAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) && process.env.CANON_LLM !== "replay";
}

function loadFixture<T>(subject: string, phase: string): T | null {
  const path = join(FIXTURE_DIR, `${fixtureKey(subject)}.${phase}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/**
 * Asks the model for a JSON object matching `schema`, or replays a fixture.
 * Structured outputs guarantee the response parses, so there is no repair path.
 */
export async function askJson<T>(opts: {
  subject: string;
  phase: string;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<LlmResult<T>> {
  if (!liveAvailable()) {
    const fixture = loadFixture<T>(opts.subject, opts.phase);
    if (fixture === null) {
      throw new Error(
        `No fixture for subject "${opts.subject}" phase "${opts.phase}" and no ANTHROPIC_API_KEY set.\n` +
          `Either ask one of the subjects in fixtures/adjudications/, or set ANTHROPIC_API_KEY ` +
          `to let canon reason about a new one. See SWAP-TO-LIVE.md.`,
      );
    }
    return { value: fixture, provenance: { source: "replay", model: MODEL, note: REPLAY_NOTE } };
  }

  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
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
