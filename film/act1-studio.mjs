// Act 1 — the evidence studio. 0:24–1:02, the heaviest beat in the cut.
//
// This is the Use-of-DataHub shot, and Use of DataHub is the tie-break
// criterion. Everything a judge needs to grade graph depth has to be visible
// here without narration: lineage edges typed COPY vs TRANSFORMED, siblings,
// assertion chips, candidates eliminating one at a time.
//
// The take waits on the page's own resolved state rather than on a timeout, so
// a slower machine yields a longer take instead of a truncated one.

import { stage } from "./lib/stage.mjs";

const URL = process.env.REPORT ?? "file://" + process.cwd() + "/../out/index.html";

await stage("takes/act1", URL, async (page, d) => {
  const studio = page.locator("#stage");
  await d.scrollToEl(studio, { ms: 1200 });
  d.beat("studio");
  await d.wait(900);

  // Press Play the way a person does — travel, settle, then press.
  await d.press(page.locator("#play"));
  d.beat("play");

  // The engine animates through its beats. Hold the camera still and let the
  // chips and the lineage graph do the talking; the label narrates itself.
  const verdict = page.locator("#verdict-tag");
  await verdict.filter({ hasText: /RESOLVED/i }).first().waitFor({ timeout: 60_000 })
    .catch(async () => {
      // Some builds settle the tag without the word; fall back to the board
      // reaching a stable state rather than failing the whole take.
      await page.waitForTimeout(12_000);
    });
  d.beat("resolved");
  await d.wait(2200);

  // Linger on the verdict text — this is the sentence the act exists to earn.
  await d.scrollToEl(page.locator("#verdict"), { ms: 900 });
  d.beat("verdict");
  await d.wait(2000);
});

console.log("act1 done");
