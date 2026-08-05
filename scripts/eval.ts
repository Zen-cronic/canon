// Ablation: canon vs the heuristics it claims to beat, on known ground truth.
//
// HONEST SIZE DISCLAIMER: this is a 3-case eval on a hand-authored fixture
// catalog, where the ground truth was decided by the same person who authored
// the catalog. It demonstrates that the naive strategies fail in distinct,
// explainable ways on realistic metadata. It is NOT a benchmark, it does not
// generalise, and the sample is far too small to support a percentage claim
// about real catalogs. Reported as counts, never as a rate.

import { createClient } from "../src/datahub/client.ts";
import { resolve } from "../src/agent/resolve.ts";
import { shortUrn } from "../src/agent/writeback.ts";

type EvalCase = {
  subject: string;
  question: string;
  searchQuery: string;
  /** Accepted answers. Siblings are one logical asset, so either is correct. */
  correct: string[];
  /** True when the honest answer is "the catalog cannot decide". */
  expectAbstain?: boolean;
  note: string;
};

const CASES: EvalCase[] = [
  {
    subject: "customer orders",
    question: "Where do I get customer orders?",
    searchQuery: "orders",
    correct: [
      "urn:li:dataset:(urn:li:dataPlatform:dbt,analytics.marts.fct_orders,PROD)",
      "urn:li:dataset:(urn:li:dataPlatform:snowflake,ANALYTICS.MARTS.FCT_ORDERS,PROD)",
    ],
    note: "Five things called orders. The mart is correct but under-adopted.",
  },
  {
    subject: "marketing contactable customers",
    question: "I need customer email addresses for a marketing campaign.",
    searchQuery: "customer email",
    correct: ["urn:li:dataset:(urn:li:dataPlatform:snowflake,ANALYTICS.MARTS.DIM_CUSTOMER_CONTACTABLE,PROD)"],
    note: "Governance case: the correct table has FEWER rows, because consent filtering removed 2.9M people.",
  },
  {
    subject: "daily revenue",
    question: "What is our daily revenue?",
    searchQuery: "revenue",
    correct: [],
    expectAbstain: true,
    note: "Two owned, current, documented marts encoding different definitions. No catalog-derivable winner.",
  },
];

type Row = {
  subject: string;
  canon: string;
  canonOk: boolean;
  baselines: Array<{ name: string; pick: string; ok: boolean }>;
};

async function main(): Promise<void> {
  const rows: Row[] = [];

  for (const c of CASES) {
    const client = await createClient(); // fresh graph per case: no cross-case leakage
    const run = await resolve(client, {
      subject: c.subject,
      question: c.question,
      searchQuery: c.searchQuery,
      force: true,
    });

    const canonPick =
      run.ruling.outcome === "ABSTAIN" ? "ABSTAIN" : (run.ruling.canonical ?? "");
    const canonOk = c.expectAbstain
      ? run.ruling.outcome === "ABSTAIN"
      : run.ruling.outcome === "RESOLVED" && c.correct.includes(canonPick);

    rows.push({
      subject: c.subject,
      canon: canonPick === "ABSTAIN" ? "ABSTAIN" : shortUrn(canonPick),
      canonOk,
      baselines: run.baselines.map((b) => ({
        name: b.baseline,
        pick: b.pick ? shortUrn(b.pick) : "—",
        // A baseline can never abstain; on the abstain case it is wrong by construction,
        // which is itself the finding: a heuristic always answers, even when it must not.
        ok: c.expectAbstain ? false : Boolean(b.pick && c.correct.includes(b.pick)),
      })),
    });
  }

  const strategies = ["canon", ...rows[0]!.baselines.map((b) => b.name)];
  const score = new Map<string, number>(strategies.map((s) => [s, 0]));
  for (const r of rows) {
    if (r.canonOk) score.set("canon", score.get("canon")! + 1);
    for (const b of r.baselines) if (b.ok) score.set(b.name, score.get(b.name)! + 1);
  }

  console.log("\ncanon ablation — same catalog, same questions, different selection strategy\n");
  console.log("Per case:\n");
  for (const [i, r] of rows.entries()) {
    console.log(`  ${i + 1}. ${r.subject}`);
    console.log(`     ${CASES[i]!.note}`);
    console.log(`     ${mark(r.canonOk)} canon                    ${r.canon}`);
    for (const b of r.baselines) {
      console.log(`     ${mark(b.ok)} ${b.name.padEnd(24)} ${b.pick}`);
    }
    console.log();
  }

  console.log("Totals (correct / 3):\n");
  for (const s of strategies) {
    const n = score.get(s)!;
    console.log(`  ${s.padEnd(26)} ${n}/3  ${"█".repeat(n)}${"·".repeat(3 - n)}`);
  }

  console.log(
    "\nDISCLAIMER: 3 cases on a hand-authored fixture catalog whose ground truth was set by\n" +
      "its author. Reported as counts, not a rate. This shows the naive strategies failing in\n" +
      "distinct explainable ways on realistic metadata — it is not a benchmark of real catalogs.\n",
  );

  const canonScore = score.get("canon")!;
  if (canonScore !== rows.length) {
    console.error(`canon scored ${canonScore}/${rows.length} — eval regression`);
    process.exitCode = 1;
  }
}

const mark = (ok: boolean): string => (ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m");

await main();
