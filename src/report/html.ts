// Renders a run into a self-contained HTML page.
//
// This is the judge-clickable artifact: static, no server, no keys, deployable
// as-is. It is a faithful record of the run that produced it, including the
// provenance banner when the model path was replayed rather than live.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolveResult } from "../agent/resolve.ts";
import { shortUrn } from "../agent/writeback.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "..", "out");

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const para = (s: string): string =>
  s
    .split("\n\n")
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

export function writeReport(
  runs: ResolveResult[],
  stats: { entities: number; platforms: number; queries: number },
): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, "index.html");
  writeFileSync(path, renderPage(runs, stats));
  return path;
}

function renderPage(runs: ResolveResult[], stats: { entities: number; platforms: number }): string {
  const first = runs[0];
  const approved = runs.find((r) => r.write);
  const second = runs.find((r) => r.answeredBy === "graph");
  const abstain = runs.find((r) => r.ruling.outcome === "ABSTAIN");
  const narratedLive = first?.ruling.narration?.source === "live";

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>canon — the catalog decides which table is real</title>
<style>${CSS}</style>
</head><body>
<header>
  <h1>canon</h1>
  <p class="tag">Every AI agent that writes SQL has to pick a table, and it picks by name. canon asks the catalog instead — then writes the answer back so nobody has to ask again.</p>
  <p class="meta">Run against a ${stats.entities}-entity catalog across ${stats.platforms} platforms.</p>
</header>

${
    narratedLive
      ? `<div class="banner ok"><strong>Rulings computed; prose written by ${esc(first?.ruling.narration?.model ?? "")}.</strong> Every ruling below was decided by the weighted rule table in <code>src/agent/rules.ts</code>. A model was then given that decision and asked to write it up — it cannot change a winner, a score or a severity.</div>`
      : `<div class="banner"><strong>Rulings computed; prose from the same rule table.</strong> Every ruling below was decided by the weighted rule table in <code>src/agent/rules.ts</code> — no model is involved in the decision on any path. No <code>ANTHROPIC_API_KEY</code> is set, so the wording is generated from the rules too. Set one to have a model write the prose; the rulings will be identical.</div>`
  }

${first ? renderBaselines(first) : ""}
${first ? renderTrace(first) : ""}
${first ? renderRuling(first) : ""}
${approved ? renderWriteBack(approved) : ""}
${first && second ? renderAskTwice(first, second) : ""}
${abstain ? renderAbstain(abstain) : ""}

<footer>
  <p>canon is a hackathon build for <strong>Build with DataHub: The Agent Hackathon</strong>. Apache-2.0.</p>
</footer>
</body></html>`;
}

function renderBaselines(run: ResolveResult): string {
  const rows = run.baselines
    .map(
      (b) => `<tr>
      <td><code>${esc(b.baseline)}</code><div class="sub">${esc(b.describes)}</div></td>
      <td class="wrong">${b.pick ? esc(shortUrn(b.pick)) : "—"}<div class="sub">${esc(b.because)}</div></td>
    </tr>`,
    )
    .join("");
  return `<section>
  <h2>1 · Three obvious strategies, three wrong answers</h2>
  <p>This is the case for canon existing. Each of these is a rule a reasonable engineer — or a text-to-SQL agent — would apply, and each picks a table that returns a confidently wrong number.</p>
  <table><thead><tr><th>Strategy</th><th>Picks</th></tr></thead><tbody>${rows}</tbody></table>
</section>`;
}

function renderTrace(run: ResolveResult): string {
  const steps = run.trace
    .map(
      (s) => `<li><span class="actor a-${s.actor}">${s.actor}</span>
      <strong>${esc(s.action)}</strong>
      <div class="sub">${esc(s.detail)}</div></li>`,
    )
    .join("");
  return `<section>
  <h2>2 · What canon actually did</h2>
  <p>Two model calls make judgment calls — which candidates deserve a look, and what the evidence means. Everything between them is plain graph traversal.</p>
  <ol class="trace">${steps}</ol>
</section>`;
}

function renderRuling(run: ResolveResult): string {
  const r = run.ruling;
  const traps = r.traps
    .map(
      (t) => `<div class="trap ${t.severity}">
      <div class="trap-head"><span class="sev">${t.severity}</span> <code>${esc(shortUrn(t.urn))}</code></div>
      <p>${esc(t.why)}</p></div>`,
    )
    .join("");
  return `<section>
  <h2>3 · The ruling</h2>
  <div class="verdict">
    <div class="use">USE → <code>${esc(shortUrn(r.queryThis ?? r.canonical ?? ""))}</code></div>
    ${r.queryThis && r.queryThis !== r.canonical ? `<div class="sub">defined by <code>${esc(shortUrn(r.canonical ?? ""))}</code> — DataHub records these as siblings, so they are one logical asset</div>` : ""}
    <div class="sub">confidence: ${esc(r.confidence)}</div>
  </div>
  ${para(r.rationale)}
  <h3>What not to use, and what happens if you do</h3>
  ${traps}
</section>`;
}

function renderWriteBack(run: ResolveResult): string {
  const receipts = (run.writeBack?.receipts ?? [])
    .map(
      (rec) =>
        `<li>${rec.applied ? "<span class='ok-i'>✓</span>" : "<span class='no-i'>✗</span>"} ${esc(rec.summary)} <code class="via">${esc(rec.via)}</code></li>`,
    )
    .join("");
  const v = run.write?.verification;
  return `<section>
  <h2>4 · Contributed back to the graph</h2>
  <p>canon plans mutations; applying them is a separate, explicit approval — deprecating a table other people and agents trust is not something an agent should do unprompted.</p>
  <ul class="receipts">${receipts}</ul>
  <div class="verify ${v?.ok ? "ok" : "bad"}">
    <strong>${v?.ok ? "VERIFIED" : "FAILED"}</strong> ${esc(v?.detail ?? "")}
    <div class="sub">After writing, canon re-derived the ruling from the graph through the ordinary client read path — the same one a fresh caller would use. A write that did not persist cannot pass this check.</div>
  </div>
</section>`;
}

function renderAskTwice(first: ResolveResult, second: ResolveResult): string {
  return `<section>
  <h2>5 · Ask the same question again</h2>
  <p>The ruling now lives in DataHub as structured properties and a Context Document. The second ask is answered by the catalog, with provenance, and never reaches a model.</p>
  <table class="compare"><thead><tr><th></th><th>First ask</th><th>Second ask</th></tr></thead><tbody>
    <tr><td>answered by</td><td>the agent</td><td class="good">the catalog</td></tr>
    <tr><td>model calls</td><td>${first.totals.modelCalls}</td><td class="good">${second.totals.modelCalls}</td></tr>
    <tr><td>graph reads</td><td>${first.totals.graphReads}</td><td class="good">${second.totals.graphReads}</td></tr>
  </tbody></table>
  <p class="pull">The agent's job is to not be needed twice.</p>
</section>`;
}

function renderAbstain(run: ResolveResult): string {
  const missing = (run.ruling.missingEvidence ?? []).map((m) => `<li>${esc(m)}</li>`).join("");
  return `<section>
  <h2>6 · When the graph genuinely can't decide</h2>
  <div class="verdict abstain"><div class="use">ABSTAIN</div></div>
  ${para(run.ruling.rationale)}
  <h3>What would settle it</h3>
  <ul>${missing}</ul>
  <p class="sub">canon files this back as an open question on both candidates rather than inventing a winner. An honest abstention is a correct answer; a fabricated one launders a disagreement into a fact.</p>
</section>`;
}

const CSS = `
:root{--bg:#fbfbfa;--fg:#1b1a17;--dim:#6b6862;--line:#e4e1da;--card:#fff;--accent:#1a6b52;--warn:#a8641b;--bad:#a83232;--code:#f2f0eb}
@media (prefers-color-scheme:dark){:root{--bg:#15171a;--fg:#e8e6e1;--dim:#93908a;--line:#2a2d31;--card:#1c1f23;--accent:#4fbf98;--warn:#d59a4e;--bad:#e07a6f;--code:#22262a}}
*{box-sizing:border-box}
body{margin:0 auto;padding:2rem 1.25rem 4rem;max-width:52rem;background:var(--bg);color:var(--fg);
font:16px/1.65 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif}
header{border-bottom:2px solid var(--fg);padding-bottom:1.5rem;margin-bottom:2rem}
h1{font-size:2.6rem;margin:0;letter-spacing:-.03em}
.tag{font-size:1.12rem;margin:.6rem 0 0;max-width:44rem}
.meta,.sub{color:var(--dim);font-size:.86rem}
.sub{margin-top:.25rem;line-height:1.5}
section{margin:2.75rem 0}
h2{font-size:1.28rem;border-bottom:1px solid var(--line);padding-bottom:.4rem;letter-spacing:-.01em}
h3{font-size:1rem;margin-top:1.6rem}
code{background:var(--code);padding:.1em .38em;border-radius:4px;font-size:.86em;
font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-word}
.banner{background:var(--card);border:1px solid var(--warn);border-left:4px solid var(--warn);
padding:.9rem 1.1rem;border-radius:6px;font-size:.9rem}
.banner.ok{border-color:var(--accent);border-left-color:var(--accent)}
table{width:100%;border-collapse:collapse;margin:1rem 0;font-size:.92rem;display:block;overflow-x:auto}
th,td{text-align:left;padding:.65rem .7rem;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;color:var(--dim)}
.wrong{color:var(--bad);font-weight:600}
.good{color:var(--accent);font-weight:600}
.trace{list-style:none;padding:0;counter-reset:s}
.trace li{counter-increment:s;padding:.7rem 0 .7rem 2.4rem;border-bottom:1px solid var(--line);position:relative}
.trace li::before{content:counter(s);position:absolute;left:0;top:.75rem;color:var(--dim);font-size:.78rem;
font-family:ui-monospace,monospace}
.actor{display:inline-block;font-size:.68rem;text-transform:uppercase;letter-spacing:.07em;padding:.12em .45em;
border-radius:3px;margin-right:.45rem;border:1px solid var(--line);color:var(--dim)}
.a-llm{color:#8b5cf6;border-color:#8b5cf6}.a-datahub{color:var(--accent);border-color:var(--accent)}
.verdict{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--accent);
padding:1.1rem 1.2rem;border-radius:6px;margin:1.2rem 0}
.verdict.abstain{border-left-color:var(--warn)}
.use{font-size:1.22rem;font-weight:700;letter-spacing:-.01em}
.trap{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:.85rem 1rem;margin:.7rem 0}
.trap.blocker{border-left:4px solid var(--bad)}.trap.warning{border-left:4px solid var(--warn)}
.trap p{margin:.45rem 0 0;font-size:.92rem}
.sev{font-size:.68rem;text-transform:uppercase;letter-spacing:.07em;font-weight:700}
.trap.blocker .sev{color:var(--bad)}.trap.warning .sev{color:var(--warn)}
.receipts{list-style:none;padding:0;font-size:.92rem}
.receipts li{padding:.4rem 0;border-bottom:1px solid var(--line)}
.ok-i{color:var(--accent);font-weight:700}.no-i{color:var(--bad);font-weight:700}
.via{font-size:.76em;color:var(--dim)}
.verify{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--accent);
padding:.9rem 1.1rem;border-radius:6px;margin-top:1rem;font-size:.92rem}
.verify.bad{border-left-color:var(--bad)}
.pull{font-size:1.15rem;font-weight:600;border-left:3px solid var(--accent);padding-left:1rem;margin:1.5rem 0}
footer{border-top:1px solid var(--line);padding-top:1.2rem;margin-top:3.5rem;color:var(--dim);font-size:.85rem}
`;
