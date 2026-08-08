// Act 2 — the obvious rules pick wrong, and the gap is priced. ~1:02–1:42.
//
// Two beats in one take because they are one argument: here is what a normal
// agent does today, and here is exactly what it costs. The pricing half is the
// Technical Execution shot — real SELECTs against a seeded warehouse, not a
// modelled estimate.
//
// Both halves are dense text, so the camera creeps rather than cuts and holds.
// A judge reading along is the point; a frozen frame just runs the clock.

import { stage } from "./lib/stage.mjs";
import { creep, dwell } from "./lib/reveal.mjs";

const URL = process.env.REPORT ?? "file://" + process.cwd() + "/../out/index.html";

await stage("takes/act2", URL, async (page, d) => {
  const baselines = page.locator("#baselines");
  await d.scrollToEl(baselines, { ms: 1200 });
  d.beat("baselines");
  await dwell(page, d, 2600, 1);

  // Three strategies, three wrong answers — creep so each row gets read.
  await creep(page, d, baselines, { distance: 560, ms: 5200, steps: 8 });
  d.beat("baselines-read");
  await dwell(page, d, 1800, 2);

  await d.scrollToEl(page.getByRole("heading", { name: /Why the wrong number was wrong/i }), {
    ms: 1100,
  });
  d.beat("why");
  await dwell(page, d, 3000, 3);

  // The three deltas: days missing, test orders, refunds never netted off.
  await creep(page, d, page.getByRole("heading", { name: /Why the wrong number was wrong/i }), {
    distance: 620,
    ms: 5400,
    steps: 8,
  });
  d.beat("deltas");
  await dwell(page, d, 2200, 4);

  // The two SQL blocks. Anyone who reads SQL will read these.
  await creep(page, d, page.locator("pre").first(), { distance: 460, ms: 4200, steps: 6 });
  d.beat("queries");
  await dwell(page, d, 2600, 5);
});

console.log("act2 done");
