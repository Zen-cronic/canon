// Act 5 — the end card. ~6s.
//
// Shot through the same rig as everything else so it carries the identical
// grain, gamma and encode. A card composited separately looks pasted on, and
// after two minutes of one visual language a viewer notices immediately.

import { stage } from "./lib/stage.mjs";
import { dwell } from "./lib/reveal.mjs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const URL = "file://" + resolve(here, "endcard.html");

await stage("takes/act5", URL, async (page, d) => {
  d.beat("card");
  await dwell(page, d, 5200, 1);
});

console.log("act5 done");
