// Ask canon one question.
//
//   node scripts/resolve.ts --subject "customer orders" \
//        --question "Where do I get customer orders?" --search orders [--approve]

import { createClient } from "../src/datahub/client.ts";
import { resolve } from "../src/agent/resolve.ts";
import { shortUrn } from "../src/agent/writeback.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const subject = arg("subject");
const question = arg("question") ?? subject;
if (!subject || !question) {
  console.error(
    'Usage: node scripts/resolve.ts --subject "customer orders" --question "..." [--search orders] [--approve] [--force]',
  );
  process.exit(2);
}

const client = await createClient();
const run = await resolve(client, {
  subject,
  question,
  searchQuery: arg("search") ?? subject,
  approve: process.argv.includes("--approve"),
  force: process.argv.includes("--force"),
});

console.log(`\nanswered by: ${run.answeredBy}`);
console.log(`outcome:     ${run.ruling.outcome}`);
if (run.ruling.canonical) {
  console.log(`use:         ${shortUrn(run.ruling.queryThis ?? run.ruling.canonical)}`);
}
console.log(`confidence:  ${run.ruling.confidence}`);
console.log(`provenance:  ${run.ruling.provenance.source} (${run.ruling.provenance.model})`);
console.log(`\n${run.ruling.rationale}\n`);

for (const t of run.ruling.traps) {
  console.log(`  [${t.severity}] ${shortUrn(t.urn)} — ${t.why}`);
}
for (const m of run.ruling.missingEvidence ?? []) {
  console.log(`  [needs] ${m}`);
}

if (run.plan && !run.write) {
  console.log(`\nplanned write-back (not applied; pass --approve):`);
  for (const s of run.plan.summary) console.log(`  · ${s}`);
}
if (run.write) {
  console.log(`\nwrite-back: ${run.write.verification.ok ? "VERIFIED" : "FAILED"} — ${run.write.verification.detail}`);
}
console.log(
  `\ntotals: ${run.totals.modelCalls} model calls, ${run.totals.graphReads} graph reads, ${run.totals.ms}ms`,
);
if (run.ruling.provenance.note) console.log(`\nNOTE: ${run.ruling.provenance.note}`);
