// Two evaluations, and the second one is the one that matters.
//
//   1. ABLATION    — on the demo catalog, what would the obvious heuristics have
//                    picked? This is the product's argument, in three lines.
//   2. UN-STACKED  — on N catalogs nobody hand-wrote, generated from a seeded
//                    PRNG with ground truth fixed at construction, how often is
//                    canon right? Including how often it correctly refuses.
//
// The second exists because the fair objection to any adjudicator demo is that
// the fixture was written by the person who wrote the adjudicator. The generator
// (src/eval/scenarios.ts) imports no rule and no weight, decides ground truth
// before anything runs, and builds roughly a third of its scenarios to be
// genuinely unanswerable.
//
// Every miss is printed. The counts are published in the README and re-checked
// by CI, so if the adjudicator drifts the build fails before the README lies.
//
//   npm run eval                 both, human-readable
//   npm run eval -- --n 40       more scenarios
//   npm run eval -- --seed 99    a different draw
//   npm run eval -- --json       machine-readable, for examples/

import { MockDataHubClient } from "../src/datahub/mock.ts";
import { resolve } from "../src/agent/resolve.ts";
import { makeScenarios } from "../src/eval/scenarios.ts";
import { shortUrn } from "../src/agent/writeback.ts";

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const SEED = arg("seed", 20260805);
const N = arg("n", 24);
const asJson = process.argv.includes("--json");
const strict = process.argv.includes("--ci");

// 1. Ablation, on the demo catalog

const demo = MockDataHubClient.load();
const hero = await resolve(demo, {
  subject: "customer orders",
  question: "Which table should I use for customer orders?",
  searchQuery: "orders",
  force: true,
});

const ablation = hero.baselines.map((b) => ({
  strategy: b.baseline,
  describes: b.describes,
  picked: b.pick,
  correct: b.pick === hero.ruling.canonical || b.pick === hero.ruling.queryThis,
  because: b.because,
}));

// 2. Un-stacked eval, on generated scenarios

type Row = {
  id: string;
  archetype: string;
  subject: string;
  expected: string | null;
  got: string | null;
  outcome: string;
  mechanism: string;
  correct: boolean;
  truthBecause: string;
  margin: number | null;
};

const scenarios = makeScenarios(SEED, N, Date.parse("2026-08-05T12:00:00Z"));
const rows: Row[] = [];

for (const s of scenarios) {
  const client = MockDataHubClient.fromCatalog(s.catalog as never);
  const run = await resolve(client, {
    subject: s.subject,
    question: s.question,
    searchQuery: s.searchQuery,
    force: true,
  });

  const got = run.ruling.outcome === "ABSTAIN" ? null : (run.ruling.canonical ?? null);
  // A sibling pair is one logical asset, so naming either side is correct.
  const correct =
    s.truth === null ? got === null : got === s.truth || run.ruling.queryThis === s.truth;

  const scores = run.adjudication?.scores ?? [];
  const margin = scores.length >= 2 ? (scores[0]?.total ?? 0) - (scores[1]?.total ?? 0) : null;

  rows.push({
    id: s.id,
    archetype: s.archetype,
    subject: s.subject,
    expected: s.truth,
    got,
    outcome: run.ruling.outcome,
    mechanism: run.ruling.mechanism.verdict,
    correct,
    truthBecause: s.truthBecause,
    margin,
  });
}

const decidable = rows.filter((r) => r.expected !== null);
const unanswerable = rows.filter((r) => r.expected === null);
const pickCorrect = decidable.filter((r) => r.correct).length;
const abstainCorrect = unanswerable.filter((r) => r.correct).length;
const misses = rows.filter((r) => !r.correct);

const summary = {
  seed: SEED,
  scenarios: rows.length,
  decidable: decidable.length,
  correctPick: pickCorrect,
  unanswerable: unanswerable.length,
  correctAbstain: abstainCorrect,
  // Ruling on a question that has no answer is the failure that matters most:
  // it launders a business disagreement into a fact.
  falseConfidence: unanswerable.filter((r) => r.outcome !== "ABSTAIN").length,
  // Refusing a question that did have an answer. Costly, but not dishonest.
  overAbstention: decidable.filter((r) => r.outcome === "ABSTAIN").length,
};

if (asJson) {
  console.log(JSON.stringify({ ablation, summary, rows }, null, 2));
} else {
  console.log("\nABLATION — same catalog, same question, different selection strategy");
  console.log(`  subject: "customer orders" on the ${demo.stats().entities}-entity demo catalog\n`);
  console.log(`  canon                  -> ${shortUrn(hero.ruling.canonical ?? "")}   CORRECT`);
  for (const a of ablation) {
    console.log(
      `  ${a.strategy.padEnd(22)} -> ${(a.picked ? shortUrn(a.picked) : "nothing").padEnd(42)} ${a.correct ? "CORRECT" : "WRONG"}`,
    );
  }
  console.log(
    "\n  Each of those is what a real tool does today — a name-matching agent, a\n" +
      "  'just use the freshest table' rule, and the social-proof rule. They pick\n" +
      "  three different wrong tables on the same question.",
  );

  console.log(`\n\nUN-STACKED EVAL — ${rows.length} generated scenarios, seed ${SEED}`);
  console.log("  Ground truth is set when each catalog is built, before any rule runs.");
  console.log("  Generator: src/eval/scenarios.ts — it imports no rule and no weight.\n");
  console.log(`  correct pick      ${pickCorrect}/${decidable.length}`);
  console.log(`  correct abstain   ${abstainCorrect}/${unanswerable.length}`);
  console.log(`  false confidence  ${summary.falseConfidence}   (ruled on a question that has no answer)`);
  console.log(`  over-abstention   ${summary.overAbstention}   (refused a question that had one)`);

  if (misses.length) {
    console.log(`\n  MISSES (${misses.length}) — printed, not filtered:`);
    for (const m of misses) {
      console.log(`\n    ${m.id}  "${m.subject}"`);
      console.log(`      expected: ${m.expected ? shortUrn(m.expected) : "ABSTAIN"}`);
      console.log(`                ${m.truthBecause}`);
      console.log(
        `      got:      ${m.got ? shortUrn(m.got) : "ABSTAIN"}  (${m.mechanism}${m.margin === null ? "" : `, margin ${m.margin}`})`,
      );
    }
  } else {
    console.log("\n  No misses at this seed. Misses are published when they happen, not hidden;");
    console.log("  try --seed 99 or --n 60 to draw a different set.");
  }

  const byArch = new Map<string, { n: number; ok: number }>();
  for (const r of rows) {
    const cur = byArch.get(r.archetype) ?? { n: 0, ok: 0 };
    cur.n++;
    if (r.correct) cur.ok++;
    byArch.set(r.archetype, cur);
  }
  console.log("\n  By archetype:");
  for (const [name, v] of [...byArch].sort()) {
    console.log(`    ${name.padEnd(24)} ${v.ok}/${v.n}${v.ok < v.n ? "  <-- has misses" : ""}`);
  }
  console.log();
}

// CI gate.
//
// This asserts the EXACT numbers the README publishes at the reference seed,
// including the one known miss. A threshold would let the result drift quietly
// under a passing build; exact counts mean any change to the rule table has to
// be looked at and the README updated in the same commit. That is the point.
const REFERENCE = { seed: 20260805, n: 24, correctPick: 12, decidable: 12, correctAbstain: 11, unanswerable: 12 };

if (strict) {
  const failures: string[] = [];
  if (SEED !== REFERENCE.seed || rows.length !== REFERENCE.n) {
    failures.push(`--ci must run the reference draw (seed ${REFERENCE.seed}, n ${REFERENCE.n})`);
  }
  if (decidable.length !== REFERENCE.decidable || pickCorrect !== REFERENCE.correctPick) {
    failures.push(
      `correct pick is ${pickCorrect}/${decidable.length}; README publishes ${REFERENCE.correctPick}/${REFERENCE.decidable}`,
    );
  }
  if (unanswerable.length !== REFERENCE.unanswerable || abstainCorrect !== REFERENCE.correctAbstain) {
    failures.push(
      `correct abstain is ${abstainCorrect}/${unanswerable.length}; README publishes ${REFERENCE.correctAbstain}/${REFERENCE.unanswerable}`,
    );
  }
  if (ablation.some((a) => a.correct)) {
    failures.push("a naive baseline now agrees with canon on the hero case — the ablation claim needs rewriting");
  }
  if (failures.length) {
    console.error("\nEVAL GATE FAILED — the published numbers no longer reproduce:");
    for (const f of failures) console.error(`  - ${f}`);
    console.error("\nFix the adjudicator or update README.md and eval/README.md in the same commit.");
    process.exit(1);
  }
  console.log(
    `eval gate: PASS — pick ${pickCorrect}/${decidable.length}, abstain ${abstainCorrect}/${unanswerable.length}, ` +
      `${misses.length} published miss(es)`,
  );
}
