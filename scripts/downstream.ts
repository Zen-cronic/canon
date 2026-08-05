// Measures what canon's write-back did to everybody else's answer.
//
//   npm run downstream           print the before/after table
//   npm run downstream -- --json machine-readable, for the report
//   npm run downstream -- --ci   assert the published numbers still hold
//
// The ranking strategies live in src/eval/downstream.ts and import none of
// canon's decision code. This script is the harness that runs canon in between
// the two measurements, which is why the canon imports are here and not there.

import { closeClient, createClient } from "../src/datahub/client.ts";
import { applyApproved, resolve } from "../src/agent/resolve.ts";
import { shortUrn } from "../src/agent/writeback.ts";
import {
  DOWNSTREAM_QUESTIONS,
  controlViolations,
  measure,
  summarise,
  type DownstreamDelta,
} from "../src/eval/downstream.ts";

const JSON_OUT = process.argv.includes("--json");
const CI = process.argv.includes("--ci");

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[36m",
};

const client = await createClient();

// Before: the catalog as it ships, with no ruling in it.
const before = new Map<string, Awaited<ReturnType<typeof measure>>>();
for (const q of DOWNSTREAM_QUESTIONS) {
  before.set(q.subject, await measure(client, q));
}

// canon runs. Every question, approved, exactly as `npm run demo` does it.
const rulings: Array<{ subject: string; outcome: string }> = [];
for (const q of DOWNSTREAM_QUESTIONS) {
  const r = await resolve(client, {
    subject: q.subject,
    question: q.question,
    searchQuery: q.query,
    force: true,
  });
  await applyApproved(client, r);
  rulings.push({ subject: q.subject, outcome: r.ruling.outcome });
}

// After: the same catalog, same strategies, same code.
const deltas: DownstreamDelta[] = [];
for (const q of DOWNSTREAM_QUESTIONS) {
  deltas.push({
    question: q,
    before: before.get(q.subject)!,
    after: await measure(client, q),
  });
}

await closeClient(client);

const summary = summarise(deltas);
const violations = controlViolations(deltas);

if (JSON_OUT) {
  console.log(JSON.stringify({ rulings, deltas, summary, violations }, null, 2));
  process.exit(violations.length > 0 ? 1 : 0);
}

const rank = (n: number | null) => (n === null ? "not offered" : `#${n}`);

console.log(`\n${C.bold}What the write-back did to the next agent's answer${C.reset}`);
console.log(
  `${C.dim}Three stock retrieval strategies, run over the same catalog before and after canon ruled.${C.reset}`,
);
console.log(`${C.dim}None of them imports canon's rules, scorer or resolver.${C.reset}\n`);

for (const d of deltas) {
  const gt = d.question.acceptable.length
    ? d.question.acceptable.map(shortUrn).join(" or ")
    : "none — this is the control";
  console.log(`${C.bold}"${d.question.question}"${C.reset}`);
  console.log(`  ${C.dim}correct answer: ${gt}${C.reset}`);
  console.log(`  ${C.dim}(${d.question.groundTruth})${C.reset}`);
  const ruled = rulings.find((r) => r.subject === d.question.subject);
  console.log(`  ${C.dim}canon: ${ruled?.outcome}${C.reset}\n`);

  for (const b of d.before) {
    const a = d.after.find((s) => s.strategy === b.strategy)!;
    const moved = b.rankOfCorrect !== a.rankOfCorrect;
    const better =
      a.rankOfCorrect !== null && (b.rankOfCorrect === null || a.rankOfCorrect < b.rankOfCorrect);
    const arrow = !moved ? `${C.dim}unchanged${C.reset}` : better ? `${C.green}improved${C.reset}` : `${C.red}worse${C.reset}`;

    if (d.question.acceptable.length === 0) {
      const same =
        b.offers.map((o) => `${o.urn}:${o.rank}`).join("|") ===
        a.offers.map((o) => `${o.urn}:${o.rank}`).join("|");
      console.log(
        `  ${C.yellow}${b.strategy.padEnd(18)}${C.reset} ordering ${same ? `${C.green}identical${C.reset}` : `${C.red}CHANGED${C.reset}`}`,
      );
      continue;
    }

    console.log(`  ${C.yellow}${b.strategy}${C.reset}`);
    console.log(`  ${C.dim}${b.describes}${C.reset}`);
    console.log(
      `    correct answer   ${rank(b.rankOfCorrect).padEnd(12)} → ${rank(a.rankOfCorrect).padEnd(12)} ${arrow}`,
    );

    // The number that actually moves: whether a client is still served the
    // table that put the wrong figure in the deck.
    const trapGone = b.trapRank !== null && a.trapRank === null;
    const trapLabel = (n: number | null) => (n === null ? `${C.green}not served${C.reset}` : `${C.red}#${n}${C.reset}`);
    console.log(
      `    the impostor     ${trapLabel(b.trapRank).padEnd(21)} → ${trapLabel(a.trapRank).padEnd(21)} ${trapGone ? `${C.green}suppressed${C.reset}` : `${C.dim}unchanged${C.reset}`}`,
    );
    console.log(
      `    ${C.dim}candidates served ${b.offeredCount} → ${a.offeredCount}; first suggestion now ${a.pick ? shortUrn(a.pick) : "nothing"}${C.reset}\n`,
    );
  }
  console.log();
}

console.log(`${C.bold}Summary${C.reset} ${C.dim}(the abstain control is excluded — it has no right answer)${C.reset}\n`);
for (const s of summary) {
  console.log(
    `  ${s.strategy.padEnd(18)} right answer first: ${s.correctAtOneBefore}/${s.scored} → ${C.bold}${s.correctAtOneAfter}/${s.scored}${C.reset}` +
      `   impostor still served: ${s.trapServedBefore}/${s.scored} → ${C.bold}${s.trapServedAfter}/${s.scored}${C.reset}`,
  );
}
console.log(
  `\n${C.dim}Read the second column. On this catalog a governance-aware client already ranked the${C.reset}`,
);
console.log(
  `${C.dim}right table first — the ruling did not have to fix that. What it fixed is that the${C.reset}`,
);
console.log(`${C.dim}staging copy behind the wrong board number stopped being offered.${C.reset}`);

if (violations.length) {
  console.log(`\n${C.red}${C.bold}CONTROL VIOLATED${C.reset}`);
  for (const v of violations) console.log(`  ${C.red}·${C.reset} ${v}`);
} else {
  console.log(
    `\n${C.dim}Control holds: the question canon abstained from ranks identically before and after.${C.reset}`,
  );
}

if (CI) {
  const problems: string[] = [...violations];
  const gov = summary.find((s) => s.strategy === "governance-aware")!;
  const marker = summary.find((s) => s.strategy === "canonical-marker")!;
  const top = summary.find((s) => s.strategy === "top-hit")!;

  // The README publishes these. If the catalog, the rules or the write-back
  // change them, the build fails rather than the claim quietly going stale.
  //
  // Note what is asserted and what is not. governance-aware is NOT asserted to
  // improve its pick, because on this catalog it was already right — asserting
  // an improvement would be asserting something false. What is asserted is that
  // it stops serving the impostor, which is the effect that exists.
  if (top.correctAtOneBefore !== 0 || top.correctAtOneAfter !== 0) {
    problems.push(
      `top-hit is metadata-blind and should stay wrong; got ${top.correctAtOneBefore} → ${top.correctAtOneAfter}`,
    );
  }
  if (gov.correctAtOneBefore !== gov.scored || gov.correctAtOneAfter !== gov.scored) {
    problems.push(
      `governance-aware should be right both before and after on this catalog; got ${gov.correctAtOneBefore} → ${gov.correctAtOneAfter} of ${gov.scored}`,
    );
  }
  if (marker.correctAtOneAfter !== marker.scored) {
    problems.push(`canonical-marker should end at ${marker.scored}/${marker.scored}; got ${marker.correctAtOneAfter}`);
  }
  for (const s of [gov, marker]) {
    if (s.trapServedBefore !== s.scored || s.trapServedAfter !== 0) {
      problems.push(
        `${s.strategy} should serve the impostor before the ruling and not after; got ${s.trapServedBefore} → ${s.trapServedAfter} of ${s.scored}`,
      );
    }
  }
  if (top.trapServedBefore !== top.scored || top.trapServedAfter !== top.scored) {
    problems.push(
      `top-hit reads no metadata, so it should keep serving the impostor; got ${top.trapServedBefore} → ${top.trapServedAfter}`,
    );
  }

  if (problems.length) {
    console.log(`\n${C.red}${C.bold}FAIL${C.reset}`);
    for (const p of problems) console.log(`  ${C.red}·${C.reset} ${p}`);
    process.exit(1);
  }
  console.log(`\n${C.green}${C.bold}PASS${C.reset} ${C.dim}published downstream numbers reproduce${C.reset}`);
}

console.log();
process.exit(0);
