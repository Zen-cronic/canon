// Act 0 — the cold open. 0:00–0:24 of the cut.
//
// The single most striking thing canon has is the struck-through number, and
// it is above the fold on load. So this take does almost nothing: it lands,
// holds long enough for a judge to read both figures and the verdict line, and
// then moves once to the claim. Restraint is the direction — a cold open that
// pans around is a cold open nobody finishes.

import { stage } from "./lib/stage.mjs";

const URL = process.env.REPORT ?? "file://" + process.cwd() + "/../out/index.html";

await stage("takes/act0", URL, async (page, d) => {
  d.beat("land");
  // Let the hero's own entrance animation finish before the camera settles.
  await d.wait(1400);

  // Hold on the wrong number, then the right one. The eye needs the beat
  // between them or the strike-through reads as decoration rather than a claim.
  await d.to(page.locator("#num-wrong"), 700);
  d.beat("wrong");
  await d.wait(1500);

  await d.to(page.locator("#num-right"), 800);
  d.beat("right");
  await d.wait(1700);

  // The verdict sentence carries the dollar figure the whole video is about.
  d.beat("verdict-line");
  await d.wait(1800);

  // One move to the claim, then out. Act 1 picks up at the studio.
  await d.scrollTo(520, 1100);
  d.beat("claim");
  await d.wait(1600);
});

console.log("act0 done");
