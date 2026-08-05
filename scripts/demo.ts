// The 60-second demo. Three beats:
//   1. Three obvious heuristics pick wrong, in three different ways.
//   2. canon investigates, rules, and writes the ruling back — after approval.
//   3. Ask again. The catalog answers. Zero model calls.

import { createClient } from "../src/datahub/client.ts";
import type { MockDataHubClient } from "../src/datahub/mock.ts";
import { resolve } from "../src/agent/resolve.ts";
import { shortUrn } from "../src/agent/writeback.ts";
import { writeReport } from "../src/report/html.ts";

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[36m",
  mag: "\x1b[35m",
};

const bar = (s: string) => `${C.dim}${"─".repeat(s.length)}${C.reset}`;

function head(n: number, title: string): void {
  const t = `${C.bold}${C.blue}${n}. ${title}${C.reset}`;
  console.log(`\n${t}`);
  console.log(bar(`${n}. ${title}`));
}

async function main(): Promise<void> {
  const client = await createClient();
  const stats = (client as unknown as MockDataHubClient).stats?.() ?? {
    entities: 0,
    platforms: 0,
    queries: 0,
  };

  console.log(`\n${C.bold}canon${C.reset} — the catalog decides which table is real`);
  console.log(
    `${C.dim}mode=${client.mode}  catalog=${stats.entities} entities across ${stats.platforms} platforms${C.reset}`,
  );

  const QUESTION = "Where do I get customer orders?";
  const SUBJECT = "customer orders";

  head(1, `A data consumer asks: "${QUESTION}"`);

  const first = await resolve(client, {
    subject: SUBJECT,
    question: QUESTION,
    searchQuery: "orders",
  });

  console.log(`\n${C.bold}What the obvious strategies pick:${C.reset}\n`);
  for (const b of first.baselines) {
    console.log(`  ${C.yellow}${b.baseline.padEnd(24)}${C.reset} → ${C.red}${b.pick ? shortUrn(b.pick) : "nothing"}${C.reset}`);
    console.log(`  ${" ".repeat(24)}   ${C.dim}${b.describes}${C.reset}`);
    console.log(`  ${" ".repeat(24)}   ${C.dim}because ${b.because}${C.reset}\n`);
  }

  head(2, "canon investigates the graph");
  for (const s of first.trace) {
    const actor =
      s.actor === "llm" ? `${C.mag}llm     ${C.reset}` : s.actor === "datahub" ? `${C.blue}datahub ${C.reset}` : `${C.green}canon   ${C.reset}`;
    console.log(`  ${C.dim}${String(s.n).padStart(2)}${C.reset} ${actor} ${C.bold}${s.action}${C.reset}`);
    console.log(`     ${C.dim}${wrap(s.detail, 92, "     ")}${C.reset}`);
  }

  head(3, "The ruling");
  const r = first.ruling;
  if (r.outcome === "RESOLVED") {
    console.log(`\n  ${C.green}${C.bold}USE → ${shortUrn(r.queryThis ?? r.canonical ?? "")}${C.reset}`);
    if (r.queryThis && r.canonical !== r.queryThis) {
      console.log(`  ${C.dim}defined by ${shortUrn(r.canonical ?? "")} (DataHub sibling — one logical asset)${C.reset}`);
    }
    console.log(`  ${C.dim}confidence: ${r.confidence}${C.reset}\n`);
    console.log(wrap(r.rationale, 96, "  "));
    console.log(`\n  ${C.bold}${C.red}Traps:${C.reset}`);
    for (const t of r.traps) {
      const tag = t.severity === "blocker" ? `${C.red}BLOCKER${C.reset}` : `${C.yellow}WARNING${C.reset}`;
      console.log(`\n  ${tag} ${C.bold}${shortUrn(t.urn)}${C.reset}`);
      console.log(wrap(t.why, 94, "    "));
    }
  }

  head(4, "Write-back plan (nothing has been written yet)");
  for (const s of first.plan?.summary ?? []) console.log(`  ${C.dim}·${C.reset} ${s}`);
  console.log(`\n  ${C.dim}canon plans mutations; applying them is a separate, explicit approval.${C.reset}`);

  head(5, "Approved — applying and verifying");
  const approved = await resolve(client, {
    subject: SUBJECT,
    question: QUESTION,
    searchQuery: "orders",
    force: true,
    approve: true,
  });
  for (const rec of approved.writeBack?.receipts ?? []) {
    console.log(`  ${rec.applied ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`} ${rec.summary} ${C.dim}(${rec.via})${C.reset}`);
  }
  const v = approved.write?.verification;
  console.log(
    `\n  ${v?.ok ? `${C.green}${C.bold}VERIFIED${C.reset}` : `${C.red}${C.bold}FAILED${C.reset}`} ${v?.detail ?? ""}`,
  );
  console.log(`  ${C.dim}canon re-read its own writes through the ordinary client read path.${C.reset}`);

  head(6, "Ask the same question again");
  const second = await resolve(client, { subject: SUBJECT, question: QUESTION, searchQuery: "orders" });
  console.log(
    `\n  answered by: ${C.bold}${second.answeredBy === "graph" ? `${C.green}the catalog${C.reset}` : `${C.yellow}the agent${C.reset}`}${C.reset}`,
  );
  console.log(`  ${C.green}${C.bold}USE → ${shortUrn(second.ruling.canonical ?? "")}${C.reset}`);
  console.log(
    `\n  ${C.bold}first ask${C.reset}   ${first.totals.modelCalls} model calls, ${first.totals.graphReads} graph reads, ${first.totals.ms}ms`,
  );
  console.log(
    `  ${C.bold}second ask${C.reset}  ${C.green}${second.totals.modelCalls} model calls${C.reset}, ${second.totals.graphReads} graph read, ${second.totals.ms}ms`,
  );
  console.log(`\n  ${C.dim}The agent's job is to not be needed twice.${C.reset}`);

  head(7, "When the graph genuinely can't decide");
  const abstain = await resolve(client, {
    subject: "daily revenue",
    question: "What's our daily revenue?",
    searchQuery: "revenue",
  });
  console.log(`\n  ${C.yellow}${C.bold}${abstain.ruling.outcome}${C.reset}\n`);
  console.log(wrap(abstain.ruling.rationale, 96, "  "));
  console.log(`\n  ${C.bold}What would settle it:${C.reset}`);
  for (const m of abstain.ruling.missingEvidence ?? []) console.log(`  ${C.dim}·${C.reset} ${wrap(m, 92, "    ").trim()}`);
  console.log(`\n  ${C.dim}canon files this back as an open question on both candidates rather than inventing a winner.${C.reset}`);

  const out = writeReport([first, approved, second, abstain], stats);
  console.log(`\n${C.dim}Full evidence report written to ${out}${C.reset}`);

  if (first.ruling.provenance.source === "replay") {
    console.log(
      `\n${C.yellow}NOTE${C.reset} ${C.dim}Model reasoning above is a committed fixture, not a live API call.`,
    );
    console.log(`     Set ANTHROPIC_API_KEY to run canon's real model path. See SWAP-TO-LIVE.md.${C.reset}`);
  }
  console.log();
}

function wrap(text: string, width: number, indent: string): string {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (!para.trim()) {
      out.push("");
      continue;
    }
    let line = indent;
    for (const word of para.split(/\s+/)) {
      if (line.length + word.length + 1 > width && line.trim()) {
        out.push(line);
        line = indent + word;
      } else {
        line = line.trim() ? `${line} ${word}` : indent + word;
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

await main();
