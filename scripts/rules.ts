// Prints the rule table.
//
// The weights are the product, so they are printable rather than buried. This
// reads the same exported array the adjudicator runs, so there is no way for
// this output and the shipped behaviour to disagree.
//
//   npm run rules
//   npm run rules -- --json

import { RULES, THRESHOLDS } from "../src/agent/rules.ts";

if (process.argv.includes("--json")) {
  console.log(
    JSON.stringify(
      { thresholds: THRESHOLDS, rules: RULES.map((r) => ({ id: r.id, aspect: r.aspect, says: r.says })) },
      null,
      2,
    ),
  );
} else {
  console.log(`\ncanon's rule table — ${RULES.length} rules, all deterministic, no model involved\n`);
  const w = Math.max(...RULES.map((r) => r.id.length));
  for (const r of RULES) {
    console.log(`  ${r.id.padEnd(w)}  ${r.aspect}`);
    console.log(`  ${" ".repeat(w)}  ${r.says}\n`);
  }
  console.log("Thresholds:");
  for (const [k, v] of Object.entries(THRESHOLDS)) console.log(`  ${k.padEnd(18)} ${v}`);
  console.log(
    "\nA candidate's score is the sum of every rule that fires. The highest score in a\n" +
      "definition class wins, provided it clears the runner-up by decisiveMargin —\n" +
      "otherwise canon abstains rather than calling a coin flip a ruling.\n",
  );
}
