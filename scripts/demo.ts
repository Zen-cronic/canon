// The 60-second demo. Three beats:
//   1. Three obvious heuristics pick wrong, in three different ways.
//   2. canon investigates, rules, and writes the ruling back — after approval.
//   3. Ask again. The catalog answers. Zero model calls.

import { execFileSync } from "node:child_process";
import { closeClient, createClient } from "../src/datahub/client.ts";
import type { MockDataHubClient } from "../src/datahub/mock.ts";
import { applyApproved, resolve } from "../src/agent/resolve.ts";
import { shortUrn } from "../src/agent/writeback.ts";
import { writeFilm, type PriceDelta } from "../src/report/film.ts";

/**
 * Prices the error with a real warehouse query. Optional: if DuckDB is not
 * installed the demo still runs, and the report says the section is unpriced
 * rather than inventing a number.
 */
function priceDelta(): PriceDelta | undefined {
  try {
    const out = execFileSync(process.env.CANON_PYTHON ?? "python3", ["bridge/price_delta.py", "--json"], {
      encoding: "utf8",
      timeout: 120_000,
    });
    return JSON.parse(out) as PriceDelta;
  } catch {
    return undefined;
  }
}

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
  // The plan that gets applied is the plan printed in step 4. Nothing
  // re-investigates in between, so what a human approved is what lands.
  await applyApproved(client, first);
  const approved = first;
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

  const price = priceDelta();
  if (price) {
    head(8, "What the wrong table costs");
    console.log(
      `\n  from the staging copy    ${C.red}$${price.wrong.revenueUsd.toLocaleString("en-US", { minimumFractionDigits: 2 })}${C.reset}`,
    );
    console.log(
      `  from the canonical table ${C.green}$${price.canonical.revenueUsd.toLocaleString("en-US", { minimumFractionDigits: 2 })}${C.reset}`,
    );
    console.log(
      `  ${C.bold}delta                    $${price.deltaUsd.toLocaleString("en-US", { minimumFractionDigits: 2 })}${C.reset} ${C.dim}(${price.deltaPct.toFixed(2)}% overstated)${C.reset}`,
    );
    console.log(`\n  ${C.dim}Two SELECTs against ${price.engine}. Not an estimate.${C.reset}`);
  }

  const out = writeFilm({
    hero: first,
    approved,
    second,
    abstain,
    stats,
    price,
    mode: client.mode,
  });
  console.log(`\n${C.dim}Full evidence report written to ${out}${C.reset}`);
  console.log(`${C.dim}Open it in a browser — it is self-contained, no server needed.${C.reset}`);

  // In live mode the MCP child processes hold the event loop open.
  await closeClient(client);

  if (first.ruling.narration?.source !== "live") {
    console.log(
      `\n${C.yellow}NOTE${C.reset} ${C.dim}The rulings above were COMPUTED by the rule table (src/agent/rules.ts),`,
    );
    console.log(`     which is the shipped decision path with or without a key. The prose wording is`);
    console.log(`     generated from that same table; set ANTHROPIC_API_KEY to have a model write it up`);
    console.log(`     instead. The decision does not change either way — that is the point.${C.reset}`);
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
process.exit(0);
