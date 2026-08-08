// Builds film/endcard.html from the report's own embedded fonts and tokens.
//
// Generated rather than hand-written for one reason: the end card follows 2:16
// of Sora and IBM Plex Mono, and a fallback system font in the last five
// seconds reads as a different project. The report already carries its faces as
// data URIs, so lifting them keeps the card self-contained AND identical — no
// network fetch, no CSP surprise, no drift when the report's design changes.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const report = readFileSync(resolve(here, "../out/index.html"), "utf8");

const faces = report.match(/@font-face\s*\{[^}]*\}/g) ?? [];
if (!faces.length) {
  throw new Error("no @font-face blocks in the report — the end card would not match the cut");
}
console.log(`lifted ${faces.length} @font-face blocks`);

const REPO = process.env.CANON_REPO ?? "github.com/Zen-cronic/canon";
const SITE = process.env.CANON_SITE ?? "zen-cronic.github.io/canon";

writeFileSync(
  resolve(here, "endcard.html"),
  `<!doctype html>
<meta charset="utf-8">
<title>canon</title>
<style>
${faces.join("\n")}
:root{--bg:#e2e4dd;--ink:#040404;--accent:#ff6100;--dim:#5f6972;--line:#c9cec8;
--display:"Sora",sans-serif;--mono:"IBM Plex Mono",monospace;--sans:"IBM Plex Sans",sans-serif}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);
  height:100vh;display:grid;place-items:center;
  background-image:linear-gradient(var(--line) 1px,transparent 1px),
                   linear-gradient(90deg,var(--line) 1px,transparent 1px);
  background-size:64px 64px;background-position:-1px -1px}
.card{text-align:center;max-width:1180px;padding:0 40px}
.mark{font-family:var(--display);font-size:112px;font-weight:700;letter-spacing:-.03em;line-height:1}
.rule{font-family:var(--mono);font-size:19px;color:var(--dim);margin-top:22px;letter-spacing:.02em}
.rule b{color:var(--ink);font-weight:600}
.links{margin-top:54px;display:flex;gap:14px;justify-content:center;flex-wrap:wrap}
.chip{font-family:var(--mono);font-size:18px;padding:13px 20px;border:1px solid var(--line);
  border-radius:10px;background:#f4f6f4}
.chip.on{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
.foot{margin-top:46px;font-family:var(--mono);font-size:15px;color:var(--dim)}
</style>
<div class="card">
  <div class="mark">canon</div>
  <div class="rule">the ruling is a <b>rule table you can read</b> — no model on any decision path</div>
  <div class="links">
    <span class="chip on">${REPO}</span>
    <span class="chip">${SITE}</span>
    <span class="chip">Apache-2.0</span>
  </div>
  <div class="foot">built on DataHub OSS · MCP Server · 257 entities across 7 platforms</div>
</div>
`,
  "utf8",
);
console.log("wrote film/endcard.html");
