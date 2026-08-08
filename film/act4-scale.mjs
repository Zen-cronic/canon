// Act 4 — every contested subject, and the refusal. ~2:06–2:50.
//
// Two beats that together answer the question a staff engineer actually has:
// "does this work on anything other than the example you chose?" The sweep
// answers it, and the abstention answers the harder follow-up — what does it do
// when the catalog genuinely cannot settle the question.
//
// The abstain beat is the Originality shot, and it is deliberately the last
// thing on screen before the end card: refusing well is the most distinctive
// thing this project does.

import { stage } from "./lib/stage.mjs";
import { creep, dwell } from "./lib/reveal.mjs";

const URL = process.env.REPORT ?? "file://" + process.cwd() + "/../out/index.html";

await stage("takes/act4", URL, async (page, d) => {
  const posture = page.locator("#posture");
  await d.scrollToEl(posture, { ms: 1200 });
  d.beat("posture");
  await dwell(page, d, 2400, 1);

  // The whole-catalog sweep. Creeping the table is the argument: there are
  // more rows than a single framing holds.
  await creep(page, d, posture, { distance: 620, ms: 5600, steps: 8 });
  d.beat("sweep");
  await dwell(page, d, 2000, 2);

  const backlog = page.locator("#backlog");
  await d.scrollToEl(backlog, { ms: 1000 });
  d.beat("backlog");
  await creep(page, d, backlog, { distance: 520, ms: 4600, steps: 7 });
  d.beat("refusals");
  await dwell(page, d, 2400, 3);

  await d.scrollToEl(page.locator("#downstream"), { ms: 1100 });
  d.beat("downstream");
  await creep(page, d, page.locator("#downstream"), { distance: 560, ms: 4800, steps: 7 });
  await dwell(page, d, 2600, 4);

  const abstain = page.locator("#abstain");
  await d.scrollToEl(abstain, { ms: 1200 });
  d.beat("abstain");
  await dwell(page, d, 3400, 5);
  await creep(page, d, abstain, { distance: 420, ms: 3600, steps: 6 });
  d.beat("abstain-read");
  await dwell(page, d, 2600, 6);
});

console.log("act4 done");
