// The falsification beat: break the winner and watch the ruling move.
//
// A demo where the agent always returns the same answer proves nothing — the
// answer could be hard-coded, replayed from a fixture, or written by a model
// that never looked at the evidence. All three have shipped in this category,
// and one of them shipped in an earlier version of this project: the ruling used
// to be replayed from a subject-keyed fixture, so poisoning the catalog changed
// precisely nothing.
//
// This script poisons the catalog on purpose and re-runs:
//
//     deprecate the winner
//     strip its owners
//     fail every one of its assertions
//     remove its Certified tag
//
// and prints both rulings side by side. Because adjudication is a pure function
// of the graph (src/agent/rules.ts), the second ruling is different, it is
// different for stated reasons, and it is different in exactly the same way on
// every run — which is what makes this safe to do on camera.
//
//   npm run poison
//   npm run poison -- --keep    leave the poisoned catalog on disk to inspect

import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { MockDataHubClient } from "../src/datahub/mock.ts";
import { resolve } from "../src/agent/resolve.ts";
import { shortUrn } from "../src/agent/writeback.ts";
import { poisonWinner } from "../src/eval/poison.ts";

const FIXTURE = process.env.CANON_FIXTURE ?? "fixtures/catalog.json";
const OPTS = {
  subject: "customer orders",
  question: "Which table should I use for customer orders?",
  searchQuery: "orders",
  force: true,
};

const C = {
  reset: "[0m",
  bold: "[1m",
  dim: "[2m",
  red: "[31m",
  green: "[32m",
  yellow: "[33m",
};

function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(14)} ${value}`);
}

// Before

const before = await resolve(MockDataHubClient.load(FIXTURE), OPTS);
const winner = before.ruling.canonical!;

console.log(`\n${C.bold}BEFORE${C.reset}  the catalog as shipped`);
line("ruling", `${C.green}${shortUrn(winner)}${C.reset}`);
line("confidence", before.ruling.confidence);
line("score", String(before.adjudication?.scores[0]?.total));
line("runner-up", `${shortUrn(before.adjudication?.scores[1]?.urn ?? "")} at ${before.adjudication?.scores[1]?.total}`);

// Poison

const { path: poisonedPath, changes } = poisonWinner(FIXTURE, winner);

console.log(`\n${C.bold}${C.red}POISON${C.reset}  applied to ${shortUrn(winner)}`);
for (const c of changes) console.log(`  ${C.red}-${C.reset} ${c}`);
console.log(`  ${C.dim}written to ${poisonedPath}${C.reset}`);

// After

const after = await resolve(MockDataHubClient.load(poisonedPath), OPTS);

console.log(`\n${C.bold}AFTER${C.reset}   same code, same question, poisoned catalog`);
line(
  "ruling",
  after.ruling.outcome === "ABSTAIN"
    ? `${C.yellow}ABSTAIN${C.reset}`
    : `${C.green}${shortUrn(after.ruling.canonical ?? "")}${C.reset}`,
);
line("confidence", after.ruling.confidence);
line("score", String(after.adjudication?.scores[0]?.total));

const poisonedScore = after.adjudication?.scores.find((s) => s.urn === winner);
if (poisonedScore) {
  line("old winner", `${shortUrn(winner)} now scores ${C.red}${poisonedScore.total}${C.reset}`);
  console.log(`\n  ${C.dim}why it lost, from the rules that fired:${C.reset}`);
  for (const h of poisonedScore.hits.filter((x) => x.delta < 0).sort((a, b) => a.delta - b.delta)) {
    console.log(`    ${String(h.delta).padStart(4)}  ${h.rule.padEnd(22)} ${h.because}`);
  }
}

// Verdict

const moved = after.ruling.canonical !== winner || after.ruling.outcome === "ABSTAIN";
console.log(
  `\n${moved ? `${C.green}RULING MOVED${C.reset}` : `${C.red}RULING DID NOT MOVE — the evidence is not reaching the verdict${C.reset}`}`,
);
console.log(
  `${C.dim}Adjudication is a pure function of the graph, so this reproduces identically\n` +
    `every run. Nothing here is replayed: there are no answer fixtures in this repo.${C.reset}\n`,
);

if (process.argv.includes("--keep")) {
  console.log(`${C.dim}(poisoned catalog kept at ${poisonedPath})${C.reset}\n`);
} else {
  rmSync(dirname(poisonedPath), { recursive: true, force: true });
  console.log(`${C.dim}(poisoned catalog discarded — pass --keep to keep it for inspection)${C.reset}\n`);
}

process.exit(moved ? 0 : 1);
