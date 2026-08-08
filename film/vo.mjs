/** Voiceover, synthesized per cue and placed at its mark.
 *
 * ElevenLabs cannot be told a timestamp, so we don't ask: each cue is its own
 * file, dropped at its mark with adelay, exact by construction. What the API
 * does return is character-level alignment, whose last end time is the line's
 * true duration, so every cue is checked against its slot BEFORE a render.
 *
 * Marks are derived, never typed. Section starts come from timeline.json,
 * which assemble.mjs measured from the takes; in-act offsets come from each
 * take's beats.json. Re-shoot an act, re-run assemble, and the whole cue sheet
 * re-times itself.
 *
 * Prefer your own read? Record a cue to takes/vo/override/<id>.mp3 (or .wav).
 * An override supersedes synthesis for that cue and faces the same fit gate.
 *
 *   node film/vo.mjs --marks       # placement report, no API calls, free
 *   node film/vo.mjs --dry         # synthesize + fit report, no mux
 *   node film/vo.mjs --no-synth    # re-place cached takes, spends no credits
 *   node film/vo.mjs               # synthesize, gate, mux
 *
 * PROSODY — why the lines read the way they do:
 *  - Legato. Em-dashes and <break> tags both insert hard stops and the read
 *    comes out chopped, so clauses join with commas and the model glides.
 *  - Falling endings. A line ending on a question mark or a preposition rises,
 *    which reads as uncertainty. Rhetorical questions are rewritten as
 *    statements for exactly that reason.
 *  - Contractions, because that is spoken English.
 *  - Numbers are spelled the way they should be said, not the way they are
 *    written on screen. The screen already shows the digits.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The operator keeps one ElevenLabs key for the whole hackathon rather than a
// copy per repo, so look in the sibling entry too. First file wins; a real
// exported variable always beats a file.
const ENV_CANDIDATES = [
  process.env.ELEVEN_ENV,
  join(import.meta.dirname, ".env"),
  join(import.meta.dirname, "..", ".env"),
  join(import.meta.dirname, "..", "..", "placeholder-3", ".env"),
].filter(Boolean);
for (const p of ENV_CANDIDATES) {
  try {
    process.loadEnvFile(p);
  } catch {}
}

const KEY = process.env.ELEVENLABS_API_KEY;
const VOICE = process.env.ELEVEN_VOICE_ID;
// multilingual_v2 over v3: v3 is more expressive and far less predictable in
// duration, and duration is the entire constraint here.
const MODEL = process.env.ELEVEN_MODEL || "eleven_multilingual_v2";
const SETTINGS_V = "s1"; // bump when voice_settings change — they live outside the cue key
// 192 kbps is Creator-tier and above; 128 is available on every tier and the mux
// re-encodes to AAC regardless, so this costs nothing audible.
const FORMAT = process.env.ELEVEN_FORMAT || "mp3_44100_128";

const HERE = import.meta.dirname;
const VIDEO = join(HERE, "out/canon-demo.mp4");
const OUT = join(HERE, "out/canon-final.mp4");
const TAKES = join(HERE, "takes/vo");
const OVERRIDE = join(TAKES, "override");

// Section starts, derived from the same timeline.json assemble.mjs wrote. Each
// xfade overlaps its pair, so every act after the first starts one fade early.
const timeline = JSON.parse(readFileSync(join(HERE, "timeline.json"), "utf8"));
const T = {};
{
  let clock = 0;
  for (const [i, t] of timeline.takes.entries()) {
    T[t.name] = clock;
    clock += t.dur - (i < timeline.takes.length - 1 ? timeline.fade : 0);
  }
}
const END = timeline.total;

// Measured beat maps. No editorial rates in this cut — takes play at 1.0 — so a
// beat's recorded time is its screen time.
const beats = {};
for (const t of timeline.takes) {
  try {
    const list = JSON.parse(readFileSync(join(HERE, "takes", t.name, "beats.json"), "utf8"));
    beats[t.name] = Object.fromEntries(list.map((b) => [b.label, b.t]));
  } catch {}
}

/* `beat` is the measured anchor ([label, offsetSeconds] inside the act); `off`
 * is the fallback used only when that act has no beat map yet. `speed`
 * (0.7–1.2) is the per-cue escape hatch for a line that will not fit any other
 * way — prefer trimming the line. */
const CUES = [
  // Line lengths are budgeted against the slots --marks reports, at roughly
  // 14 characters per second. The picture is not re-cut to fit the script; the
  // script is written to fit the picture, because a hold that exists only to
  // let narration finish reads as padding.
  { sec: "act0", beat: ["land", 0.4], off: 0.4, id: "act0-hook", speed: 1.0, text:
    "Two dashboards disagree about revenue, and the board deck goes out in the morning." },
  { sec: "act0", beat: ["verdict-line", 0.2], off: 6.6, id: "act0-verdict", speed: 1.0, text:
    "It came from the wrong table. Off by eight hundred and thirty thousand dollars." },

  { sec: "act1", beat: ["play", 0.3], off: 3.2, id: "act1-reads", speed: 1.0, text:
    "canon reads the graph DataHub already has, including the lineage edge type." },
  { sec: "act1", beat: ["resolved", 0.4], off: 10.1, id: "act1-rules", speed: 1.0, text:
    "A copy and a modelled table aren't the same claim. Twenty-two weighted rules decide, no model." },

  { sec: "act2", beat: ["baselines", 0.4], off: 1.2, id: "act2-strawmen", speed: 1.0, text:
    "These aren't straw men. Name matching, freshest table, and social proof are what agents do today." },
  { sec: "act2", beat: ["baselines-read", 0.6], off: 12.3, id: "act2-wrong", speed: 1.0, text:
    "All three pick a copy that's three days stale." },
  { sec: "act2", beat: ["why", 0.5], off: 16.1, id: "act2-priced", speed: 1.0, text:
    "The gap isn't an estimate. Both figures are selects against a warehouse built from a fixed seed." },
  { sec: "act2", beat: ["deltas", 0.4], off: 27.7, id: "act2-deltas", speed: 1.0, text:
    "Three days of orders missing, five hundred and eighteen test orders counted as revenue, and a third of a million in refunds never netted off." },

  { sec: "act3", beat: ["plan", 0.5], off: 1.2, id: "act3-writeback", speed: 1.0, text:
    "A ruling that stays inside the agent helps nobody." },
  { sec: "act3", beat: ["aim", 0.2], off: 5.1, id: "act3-human", speed: 1.0, text:
    "So canon plans, and a human applies. That's the one decision it won't make." },
  { sec: "act3", beat: ["receipts", 0.3], off: 10.3, id: "act3-receipts", speed: 1.0, text:
    "Every line names the transport that carried it." },
  { sec: "act3", beat: ["ask-twice", 0.3], off: 13.8, id: "act3-loop", speed: 1.0, text:
    "Ask again, and a stock client returns the canonical table." },

  { sec: "act4", beat: ["posture", 0.4], off: 1.2, id: "act4-sweep", speed: 1.0, text:
    "One hand picked question is what you'd show if it were the only one that worked. So here's every contested concept in the catalog, through the same adjudicator." },
  { sec: "act4", beat: ["refusals", 0.4], off: 23.1, id: "act4-refusals", speed: 1.0, text:
    "Each abstention names what would settle it." },
  { sec: "act4", beat: ["downstream", 0.4], off: 27.5, id: "act4-downstream", speed: 1.0, text:
    "The write back only matters if somebody else is better off, so these clients import none of canon's code." },
  { sec: "act4", beat: ["abstain", 0.5], off: 39.2, id: "act4-abstain", speed: 1.0, text:
    "Two tables, same grain, both owned, measuring genuinely different things. Ruling would launder a disagreement into a fact, so canon refuses." },

  { sec: "act5", beat: ["card", 0.5], off: 0.5, id: "endcard", speed: 1.0, text:
    "canon. The ruling is a rule table you can read." },
];

const resolved = CUES.map((c) => {
  const b = c.beat && beats[c.sec]?.[c.beat[0]];
  const off = b !== undefined ? b + c.beat[1] : c.off;
  return { ...c, at: (T[c.sec] ?? 0) + off, timedBy: b !== undefined ? "beat" : "off" };
});

// Marks must increase; adelay would happily mux two lines on top of each other.
{
  const bad = resolved.slice(1).map((c, i) => [resolved[i], c]).filter(([p, c]) => c.at <= p.at);
  if (bad.length) {
    console.error("\ncue marks are not in order — the capture and the cue sheet disagree:");
    for (const [p, c] of bad) {
      console.error(`  ${c.id} @ ${c.at.toFixed(1)}s <= ${p.id} @ ${p.at.toFixed(1)}s`);
    }
    process.exit(2);
  }
}

const args = process.argv.slice(2);
const synth = !args.includes("--no-synth");
const dry = args.includes("--dry");

if (args.includes("--marks")) {
  console.log("\nmark    slot  timing  cue");
  resolved.forEach((c, i) => {
    const slot = (resolved[i + 1]?.at ?? END) - c.at;
    const mm = `${Math.floor(c.at / 60)}:${(c.at % 60).toFixed(1).padStart(4, "0")}`;
    console.log(
      `${mm.padStart(6)} ${slot.toFixed(1).padStart(5)}s  ` +
      `${(c.timedBy === "beat" ? "beat" : "OFF ").padEnd(6)}  ${c.id}`,
    );
  });
  console.log(`\ntotal ${END.toFixed(1)}s across ${resolved.length} cues`);
  process.exit(0);
}

const probeDur = (f) =>
  parseFloat(
    execFileSync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f,
    ]).toString().trim(),
  );

async function speak(cue, i) {
  // An operator-recorded read supersedes synthesis; the same slot gate applies.
  for (const ext of ["mp3", "wav"]) {
    const human = join(OVERRIDE, `${cue.id}.${ext}`);
    if (existsSync(human)) return { file: human, dur: probeDur(human), cached: true, human: true };
  }

  const file = join(TAKES, `${String(i).padStart(2, "0")}-${cue.id}.mp3`);
  const meta = `${file}.json`;
  // Content-addressed: the request IS the key, so editing one line re-synthesizes
  // only that line.
  const key = createHash("sha1")
    .update(`${MODEL} ${FORMAT} ${SETTINGS_V} ${cue.speed ?? 1.0} ${cue.text}`)
    .digest("hex");
  const cached = existsSync(meta) ? JSON.parse(readFileSync(meta, "utf8")) : null;
  if (cached?.key === key) return { file, ...cached, cached: true };
  if (!synth) throw new Error(`--no-synth but ${cue.id} is ${cached ? "stale" : "missing"}`);

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/with-timestamps?output_format=${FORMAT}`,
    {
      method: "POST",
      headers: { "xi-api-key": KEY, "content-type": "application/json" },
      body: JSON.stringify({
        text: cue.text,
        model_id: MODEL,
        // stability 0.55: "sameness". Lower lets pitch wander, which is where
        // uptalk creeps in; past ~0.65 it flattens toward monotone.
        // style 0.0: style exaggeration lifts the end of a clause, the exact
        // question-like rise to avoid.
        voice_settings: {
          stability: 0.55,
          similarity_boost: 0.85,
          style: 0.0,
          speed: cue.speed ?? 1.0,
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`${cue.id}: ${res.status} ${await res.text()}`);
  const body = await res.json();
  writeFileSync(file, Buffer.from(body.audio_base64, "base64"));
  // normalized_alignment tracks what was actually spoken; its last end time is
  // the real duration, not a words-per-minute guess.
  const ends = body.normalized_alignment?.character_end_times_seconds ?? [];
  const dur = ends.length ? ends[ends.length - 1] : 0;
  writeFileSync(meta, JSON.stringify({ key, dur }));
  return { file, dur, cached: false };
}

mkdirSync(OVERRIDE, { recursive: true });
if (synth && (!KEY || !VOICE)) {
  console.error("set ELEVENLABS_API_KEY and ELEVEN_VOICE_ID (or pass --no-synth / --marks)");
  console.error(`looked in: ${ENV_CANDIDATES.join(", ")}`);
  process.exit(1);
}

const takes = [];
for (const [i, cue] of resolved.entries()) takes.push({ cue, ...(await speak(cue, i)) });

let over = 0;
let fresh = 0;
console.log("\nmark   slot   spoken   fit   cue");
for (const [i, t] of takes.entries()) {
  const slot = (resolved[i + 1]?.at ?? END) - t.cue.at;
  const ok = t.dur <= slot;
  if (!ok) over++;
  if (!t.cached) fresh++;
  const mm = `${Math.floor(t.cue.at / 60)}:${(t.cue.at % 60).toFixed(1).padStart(4, "0")}`;
  console.log(
    `${mm.padStart(5)}  ${slot.toFixed(1).padStart(5)}s ${t.dur.toFixed(1).padStart(6)}s  ` +
    `${(ok ? "ok" : `+${(t.dur - slot).toFixed(1)}s`).padStart(6)}  ` +
    `${t.cue.timedBy === "beat" ? " " : "~"}${t.cue.id}${t.human ? "  [yours]" : t.cached ? "" : "  *"}`,
  );
}
if (fresh) {
  const chars = takes.filter((t) => !t.cached).reduce((n, t) => n + t.cue.text.length, 0);
  console.log(`\n* ${fresh} cue(s) newly synthesized, ~${chars} credits`);
}
console.log(over ? `\n${over} cue(s) overrun — trim the line or lengthen the hold\n` : "\nall cues fit\n");

// An overrun IS an audible overlap: hard gate, not a warning. TOL absorbs the
// model's own run-to-run variance.
const TOL = 0.15;
if (!dry && !args.includes("--force")) {
  const bad = takes.filter((t, i) => t.dur - ((resolved[i + 1]?.at ?? END) - t.cue.at) > TOL);
  if (bad.length) {
    console.error(`refusing to mux: ${bad.length} line(s) would talk over the next.`);
    console.error(`  ${bad.map((t) => t.cue.id).join(", ")}`);
    console.error("fix the line, move the mark, or pass --force and mean it.\n");
    process.exit(3);
  }
}
if (dry) process.exit(over ? 1 : 0);

// Place every take at its mark, sum, lay over the picture. normalize=0 is
// load-bearing: amix's default divides by input count and everything goes quiet.
// apad stops -shortest trimming the video to the last word.
const inputs = takes.flatMap((t) => ["-i", t.file]);
const delays = takes.map((t, i) => `[${i + 1}:a]adelay=${Math.round(t.cue.at * 1000)}:all=1[d${i}]`);
const chain =
  `${delays.join(";")};${takes.map((_, i) => `[d${i}]`).join("")}` +
  // normalize=0 on amix is load-bearing: its default divides by input count and
  // seventeen cues would come out near-silent.
  // loudnorm rather than a fixed gain: measured at -21.8 LUFS the first time,
  // and YouTube normalizes loud audio DOWN but never boosts quiet audio up, so
  // a quiet master just plays quiet for the judge. -16 LUFS with 1.5 dB of true
  // peak headroom survives their transcode.
  `amix=inputs=${takes.length}:normalize=0,` +
  `loudnorm=I=-16:TP=-1.5:LRA=11,` +
  `aformat=channel_layouts=stereo:sample_rates=48000,apad[a]`;

execFileSync("ffmpeg", [
  "-y", "-loglevel", "warning",
  "-i", VIDEO, ...inputs,
  "-filter_complex", chain,
  "-map", "0:v:0", "-map", "[a]",
  "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest",
  // Re-apply faststart: -c:v copy carries the video through untouched but the
  // container is rewritten, so the moov atom lands at the end again unless we
  // ask. verify.mjs checks this from the bytes and caught it.
  "-movflags", "+faststart", OUT,
], { stdio: ["ignore", "ignore", "inherit"] });
console.log(`wrote ${OUT}`);
