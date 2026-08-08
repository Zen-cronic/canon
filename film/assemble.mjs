// Composite the takes into the cut.
//
// Hard cuts between two scroll positions of the same page read as a glitch —
// the eye cannot tell a cut from a jump. A short xfade at each seam reads as an
// edit instead. 0.28s is enough to register and short enough not to soften the
// numbers, which are the whole point of the picture.
//
// The order and the seam length are the only editorial decisions here; every
// duration is measured from the takes themselves, so re-shooting one act
// re-times the cut without anything being retyped.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ACTS = ["act0", "act1", "act2", "act3", "act4", "act5"];
const FADE = 0.28;

const probe = (f) =>
  Number(
    execFileSync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f,
    ], { encoding: "utf8" }).trim(),
  );

const takes = ACTS.map((a) => {
  const file = resolve(here, `takes/${a}/capture.mp4`);
  if (!existsSync(file)) throw new Error(`missing take: ${file} — run ./capture.sh ${a.slice(3)}`);
  return { name: a, file, dur: probe(file) };
});

console.log("takes:");
let raw = 0;
for (const t of takes) {
  console.log(`  ${t.name}  ${t.dur.toFixed(2)}s`);
  raw += t.dur;
}

// Each xfade overlaps the pair by FADE, so the cut loses FADE per seam.
const seams = takes.length - 1;
const total = raw - seams * FADE;
console.log(`\nraw ${raw.toFixed(2)}s  -  ${seams} seams x ${FADE}s  =  ${total.toFixed(2)}s`);
if (total > 180) throw new Error(`cut is ${total.toFixed(1)}s — over the 3:00 hard cap`);

const args = [];
for (const t of takes) args.push("-i", t.file);

const filters = [];
let prev = "0:v";
let offset = 0;
for (let i = 1; i < takes.length; i++) {
  offset += takes[i - 1].dur - FADE;
  const out = i === takes.length - 1 ? "v" : `x${i}`;
  filters.push(
    `[${prev}][${i}:v]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(3)}[${out}]`,
  );
  prev = out;
}

mkdirSync(resolve(here, "out"), { recursive: true });
const output = resolve(here, "out/canon-demo.mp4");

execFileSync("ffmpeg", [
  "-y", "-loglevel", "warning",
  ...args,
  "-filter_complex", filters.join(";"),
  "-map", "[v]",
  "-c:v", "libx264", "-preset", "slow", "-crf", "18",
  "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart",
  output,
], { stdio: "inherit" });

writeFileSync(
  resolve(here, "timeline.json"),
  JSON.stringify({ fade: FADE, total: Number(total.toFixed(2)), takes }, null, 2) + "\n",
);

console.log(`\nwrote ${output}`);
console.log("wrote timeline.json — the one clock; a voiceover pass reads its offsets");
