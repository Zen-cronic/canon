// The catalog's contested-subject posture.
//
//   npm run coverage             the table
//   npm run coverage -- --json   machine-readable
//   npm run coverage -- --ci     assert the published posture still holds
//   npm run coverage -- --limit 10
//
// Read-only. It runs the adjudicator over every contested subject and writes
// nothing back — a survey should not change the thing it is surveying.

import { closeClient, createClient } from "../src/datahub/client.ts";
import { resolve } from "../src/agent/resolve.ts";
import { shortUrn } from "../src/agent/writeback.ts";
import {
  allEntities,
  findContested,
  summarisePosture,
  type SubjectOutcome,
} from "../src/eval/coverage.ts";

const JSON_OUT = process.argv.includes("--json");
const CI = process.argv.includes("--ci");
const LIMIT = process.argv.includes("--limit")
  ? Number(process.argv[process.argv.indexOf("--limit") + 1] ?? 0)
  : 0;

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
const entities = await allEntities(client);
let contested = findContested(entities);
const discovered = contested.length;
if (LIMIT > 0) contested = contested.slice(0, LIMIT);

if (!JSON_OUT) {
  console.log(`\n${C.bold}Contested-subject posture${C.reset}`);
  console.log(
    `${C.dim}${entities.length} entities read · ${discovered} concepts that more than one asset answers to${C.reset}`,
  );
  console.log(
    `${C.dim}Contested means exactly that — not "unhealthy". Catalog health dashboards already exist.${C.reset}\n`,
  );
}

const outcomes: SubjectOutcome[] = [];
for (const c of contested) {
  const r = await resolve(client, {
    subject: c.subject,
    question: `Which asset should I use for ${c.subject}?`,
    searchQuery: c.subject,
    force: true,
  });
  const outcome: SubjectOutcome = {
    subject: c.subject,
    candidates: c.members.length,
    platforms: c.platforms,
    outcome: r.ruling.outcome,
    mechanism: r.ruling.mechanism.verdict,
    ms: r.totals.ms,
    modelCalls: r.totals.modelCalls,
    graphReads: r.totals.graphReads,
  };
  if (r.ruling.outcome === "RESOLVED") {
    outcome.confidence = r.ruling.confidence;
    outcome.canonical = r.ruling.queryThis ?? r.ruling.canonical;
  } else {
    outcome.cause = r.adjudication?.abstainCause ?? r.ruling.mechanism.verdict;
    outcome.missing = r.ruling.missingEvidence ?? [];
  }
  outcomes.push(outcome);

  if (!JSON_OUT) {
    const mark =
      outcome.outcome === "RESOLVED"
        ? `${C.green}RULED   ${C.reset}`
        : outcome.cause === "COMPETING_DEFINITIONS"
          ? `${C.yellow}OWNERS  ${C.reset}`
          : `${C.blue}EVIDENCE${C.reset}`;
    const detail =
      outcome.outcome === "RESOLVED"
        ? `${shortUrn(outcome.canonical ?? "")} ${C.dim}(${outcome.confidence})${C.reset}`
        : `${C.dim}${outcome.cause}${C.reset}`;
    console.log(
      `  ${mark} ${outcome.subject.padEnd(22)} ${C.dim}${String(outcome.candidates).padStart(2)} candidates${C.reset}  ${detail}`,
    );
  }
}

await closeClient(client);

const posture = summarisePosture(entities.length, outcomes);

if (JSON_OUT) {
  console.log(JSON.stringify(posture, null, 2));
  process.exit(0);
}

console.log(`\n${C.bold}Posture${C.reset}\n`);
console.log(`  contested subjects        ${posture.contested}`);
console.log(`  ${C.green}ruled${C.reset}                     ${posture.ruled}`);
console.log(`  ${C.yellow}referred to owners${C.reset}        ${posture.referredToOwners}  ${C.dim}two definitions share a word — a person has to settle it${C.reset}`);
console.log(`  ${C.blue}needs more evidence${C.reset}       ${posture.needsMoreEvidence}  ${C.dim}the catalog does not carry enough to separate them${C.reset}`);
console.log(
  `\n${C.dim}The refusals are not 'canon could not'. They are 'the catalog does not say', and each${C.reset}`,
);
console.log(`${C.dim}one names what would settle it — so the abstentions are a work list:${C.reset}\n`);
for (const b of posture.backlog.slice(0, 6)) {
  console.log(`  ${C.bold}${String(b.blocks).padStart(3)}${C.reset} subjects blocked on  ${b.need}`);
}

console.log(
  `\n  ${C.dim}${posture.totals.modelCalls} model calls across all ${posture.contested} subjects · ` +
    `${posture.totals.graphReads} graph reads · ${posture.totals.ms}ms total${C.reset}`,
);
console.log(
  `  ${C.dim}${(posture.totals.ms / posture.contested).toFixed(1)}ms and ${(posture.totals.graphReads / posture.contested).toFixed(1)} graph reads per subject — the decision layer is a rule table, so this is what re-running the whole catalog costs.${C.reset}`,
);

if (CI) {
  const problems: string[] = [];
  if (posture.contested !== discovered) problems.push("--ci must run the full set; drop --limit");

  // The README publishes these four numbers. Pinned exactly rather than as
  // thresholds: a threshold lets the ruled count drift downwards under a green
  // build, and the whole point of publishing them is that they cannot.
  const EXPECTED = { contested: 55, ruled: 14, referredToOwners: 1, needsMoreEvidence: 40 };
  for (const [k, want] of Object.entries(EXPECTED)) {
    const got = posture[k as keyof typeof EXPECTED];
    if (got !== want) problems.push(`README publishes ${k} = ${want}; this run produced ${got}`);
  }
  if (posture.ruled + posture.referredToOwners + posture.needsMoreEvidence !== posture.contested) {
    problems.push("every contested subject must land in exactly one bucket");
  }
  // The decision layer is a rule table, so no subject may reach a model.
  if (posture.totals.modelCalls !== 0) {
    problems.push(`the sweep must make no model calls; made ${posture.totals.modelCalls}`);
  }
  if (posture.referredToOwners < 1) {
    problems.push("at least one subject must be referred to owners, or ABSTAIN is untested here");
  }
  if (problems.length) {
    console.log(`\n${C.red}${C.bold}FAIL${C.reset}`);
    for (const p of problems) console.log(`  ${C.red}·${C.reset} ${p}`);
    process.exit(1);
  }
  console.log(`\n${C.green}${C.bold}PASS${C.reset} ${C.dim}posture holds${C.reset}`);
}

console.log();
process.exit(0);
