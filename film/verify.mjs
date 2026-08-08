// Gate the cut before it is uploaded.
//
// Every check here maps to a rule that can cost the submission, not to a taste
// preference. A video the judges cannot watch scores zero on a fifth of the
// rubric, and there is no appeal after the deadline.

import { execFileSync } from "node:child_process";
import { existsSync, openSync, readSync, closeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** True when the moov atom precedes mdat, i.e. -movflags +faststart took.
 *
 * Checked against the bytes rather than inferred from the container name: a
 * gate that cannot fail is not a gate, and this repo's whole argument is that
 * a claim you cannot check is not evidence. */
function faststart(path) {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(256 * 1024);
    const n = readSync(fd, buf, 0, buf.length, 0);
    const head = buf.subarray(0, n).toString("latin1");
    const moov = head.indexOf("moov");
    const mdat = head.indexOf("mdat");
    if (moov === -1) return false; // moov not even in the first 256KB
    return mdat === -1 || moov < mdat;
  } finally {
    closeSync(fd);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? resolve(here, "out/canon-demo.mp4");

if (!existsSync(file)) {
  console.error(`no cut at ${file} — run: node assemble.mjs`);
  process.exit(1);
}

const probe = JSON.parse(
  execFileSync("ffprobe", [
    "-v", "error", "-print_format", "json",
    "-show_format", "-show_streams", file,
  ], { encoding: "utf8" }),
);

const v = probe.streams.find((s) => s.codec_type === "video");
const a = probe.streams.find((s) => s.codec_type === "audio");
const dur = Number(probe.format.duration);
const mb = Number(probe.format.size) / 1e6;

const checks = [
  ["video stream present", !!v],
  ["H.264", v?.codec_name === "h264"],
  ["1920x1080", v?.width === 1920 && v?.height === 1080],
  ["yuv420p (plays everywhere)", v?.pix_fmt === "yuv420p"],
  ["under the 3:00 hard cap", dur < 180],
  ["at least 60s of substance", dur > 60],
  ["faststart (moov before mdat)", faststart(file)],
];

let failed = 0;
console.log(`\n${file}`);
console.log(`  ${dur.toFixed(2)}s · ${mb.toFixed(1)} MB · ${v?.width}x${v?.height} ${v?.codec_name}\n`);
for (const [label, ok] of checks) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failed++;
}

// Narration is not a hard gate — a well-captioned silent cut is submittable —
// but shipping one by accident is a different thing from choosing one.
console.log(`\n  ${a ? "PASS" : "NOTE"}  audio track ${a ? `(${a.codec_name})` : "absent — no voiceover yet"}`);

console.log(`
  Manual gates, not checkable from the file:
    [ ] uploaded PUBLIC to YouTube / Vimeo / Youku (Devpost rejects other hosts)
    [ ] YouTube: marked "Not made for Kids", or judges are locked out
    [ ] no third-party trademarks, no copyrighted music
    [ ] English
    [ ] uploaded EARLY — processing time has sunk submissions
`);

if (failed) {
  console.error(`${failed} gate(s) failed`);
  process.exit(1);
}
console.log("all automated gates pass\n");
