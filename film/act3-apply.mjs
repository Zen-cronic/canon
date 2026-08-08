// Act 3 — the write-back, and the one click canon does not make itself.
// 1:40–2:06.
//
// The fulcrum. Everything before this is analysis; this is the beat where the
// graph changes, and it changes because a human said so. Direction note from
// the run-of-show: pause before AND after the press, so it reads as a decision
// rather than as the next step in a script.

import { stage } from "./lib/stage.mjs";

const URL = process.env.REPORT ?? "file://" + process.cwd() + "/../out/index.html";

await stage("takes/act3", URL, async (page, d) => {
  await d.scrollToEl(page.locator("#plan"), { ms: 1200 });
  d.beat("plan");
  await d.wait(2800); // the proposed mutations, before anything is applied

  const approve = page.locator("#approve");
  await d.to(approve, 780);
  d.beat("aim");
  await d.wait(1100); // hold on the unpressed button — this is the fulcrum

  await d.press(approve, { travel: 260, settle: 320 });
  d.beat("approve");

  // Wait for the page's own confirmation rather than a fixed sleep: the
  // receipts render asynchronously and a timeout would sometimes film the
  // moment before the thing the act is about.
  await page.locator("#applied").waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
  d.beat("applied");
  await d.wait(2400);

  await d.scrollToEl(page.locator("#receipts"), { ms: 1000 });
  d.beat("receipts");
  await d.wait(2400); // every line names the transport that carried it

  // The loop closing: ask the same question again, get the canonical table.
  await d.scrollToEl(page.locator("#ask-twice"), { ms: 1100 });
  d.beat("ask-twice");
  await d.wait(2800);
});

console.log("act3 done");
