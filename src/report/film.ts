// The judge-clickable artifact: one self-contained HTML file, no server, no
// network, no keys.
//
// It is built to be understood with the sound off. Three rules govern it:
//
//   1. Every beat leaves a number on screen that changed. $7.95M becomes
//      $7.12M. Five candidates become one ruling. Four rules fired, worth +71.
//      Someone watching a muted recording can still follow the argument.
//   2. The DataHub vocabulary is diegetic. URNs, aspect names and tool names
//      appear in the interface because the interface is reading them, not
//      because a voiceover mentions them. The rail along the bottom always says
//      which URN and which aspect is in play.
//   3. Nothing here is decoration over a claim. Every score bar is the number
//      the rule table produced, every receipt names the transport that actually
//      carried the write, and the page states when it is showing fixture data.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolveResult } from "../agent/resolve.ts";
import { shortUrn } from "../agent/writeback.ts";
import { THRESHOLDS } from "../agent/rules.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "..", "out");

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type PriceDelta = {
  wrong: { table: string; revenueUsd: number; orders: number; query: string };
  canonical: { table: string; revenueUsd: number; orders: number; query: string };
  deltaUsd: number;
  deltaPct: number;
  causes: { missingDays: number; testOrdersIncluded: number; refundsNotNettedUsd: number };
  engine: string;
  seed: number;
};

export type FilmData = {
  hero: ResolveResult;
  approved: ResolveResult;
  second: ResolveResult;
  abstain: ResolveResult;
  stats: { entities: number; platforms: number; queries: number };
  price?: PriceDelta | undefined;
  mode: "mock" | "live";
  serverInfo?: string | undefined;
};

const usd = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const usdShort = (n: number): string => `$${(n / 1_000_000).toFixed(2)}M`;

export function writeFilm(data: FilmData): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, "index.html");
  writeFileSync(path, render(data));
  return path;
}

/** Everything the page's script needs, serialised once. */
function payload(data: FilmData): string {
  const adj = data.hero.adjudication;
  const scores = (adj?.scores ?? []).map((s) => ({
    urn: s.urn,
    label: shortUrn(s.urn),
    total: s.total,
    rank: s.rank,
    hits: s.hits.map((h) => ({ rule: h.rule, delta: h.delta, because: h.because })),
  }));

  const evidence = data.hero.evidence.map((e) => ({
    urn: e.entity.urn,
    label: shortUrn(e.entity.urn),
    platform: e.entity.platform,
    subType: e.entity.subType,
    rows: e.entity.profile?.rowCount ?? null,
    staleDays: e.stalenessDays,
    owners: e.entity.owners.length,
    humanQueries: e.humanQueryCount,
    assertions: (e.entity.assertions ?? []).map((a) => ({ type: a.type, result: a.lastResult })),
    deprecated: Boolean(e.entity.deprecation?.deprecated),
    upstreams: e.entity.upstreams.map((u) => ({ urn: u.dataset, type: u.type })),
    siblingOf: e.siblingOf ?? null,
  }));

  return JSON.stringify({
    subject: data.hero.subject,
    ruling: {
      outcome: data.hero.ruling.outcome,
      canonical: data.hero.ruling.canonical ?? null,
      canonicalLabel: data.hero.ruling.canonical ? shortUrn(data.hero.ruling.canonical) : null,
      queryThis: data.hero.ruling.queryThis ?? null,
      queryThisLabel: data.hero.ruling.queryThis ? shortUrn(data.hero.ruling.queryThis) : null,
      confidence: data.hero.ruling.confidence,
      rationale: data.hero.ruling.rationale,
      mechanism: data.hero.ruling.mechanism,
      traps: data.hero.ruling.traps.map((t) => ({ urn: t.urn, label: shortUrn(t.urn), why: t.why, severity: t.severity })),
    },
    scores,
    evidence,
    trace: data.hero.trace,
    baselines: data.hero.baselines.map((b) => ({
      name: b.baseline,
      describes: b.describes,
      pick: b.pick,
      label: b.pick ? shortUrn(b.pick) : "nothing",
      because: b.because,
      correct: b.pick === data.hero.ruling.canonical || b.pick === data.hero.ruling.queryThis,
    })),
    receipts: (data.approved.writeBack?.receipts ?? []).map((r) => ({
      via: r.via,
      applied: r.applied,
      summary: r.summary,
    })),
    verification: data.approved.write?.verification.detail ?? null,
    verified: data.approved.write?.verification.ok ?? false,
    second: { reads: data.second.totals.graphReads, answeredBy: data.second.answeredBy },
    abstain: {
      rationale: data.abstain.ruling.rationale,
      mechanism: data.abstain.ruling.mechanism,
      missing: data.abstain.ruling.missingEvidence ?? [],
      candidates: data.abstain.evidence.map((e) => ({
        label: shortUrn(e.entity.urn),
        description: e.entity.description ?? "",
        columns: e.entity.schema.map((f) => f.fieldPath),
      })),
    },
    price: data.price ?? null,
    stats: data.stats,
    mode: data.mode,
    thresholds: THRESHOLDS,
  });
}

function render(data: FilmData): string {
  const price = data.price;
  const wrongNumber = price ? usd(price.wrong.revenueUsd) : "$7,951,811.55";
  const rightNumber = price ? usd(price.canonical.revenueUsd) : "$7,121,844.95";

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>canon — can I send this number to the board?</title>
<style>${CSS}</style>
</head><body>

<div class="rail" id="rail">
  <span class="rail-k">DataHub</span>
  <span class="rail-urn" id="rail-urn">urn:li:dataset:(urn:li:dataPlatform:…)</span>
  <span class="rail-k">aspect</span>
  <span class="rail-aspect" id="rail-aspect">—</span>
  <span class="rail-mode">${data.mode === "live" ? `live · ${esc(data.serverInfo ?? "DataHub OSS")}` : "fixture catalog"}</span>
</div>

<header class="hero">
  <p class="clock">Friday, 4:55 PM</p>
  <h1>Can I send this number to the board?</h1>
  <div class="numbers">
    <div class="num num-wrong" id="num-wrong">
      <span class="num-label">the number in the deck</span>
      <span class="num-value">${esc(wrongNumber)}</span>
      <span class="num-src" id="num-wrong-src">from ANALYTICS.STAGING.STG_ORDERS</span>
    </div>
    <div class="num-arrow" id="num-arrow">→</div>
    <div class="num num-right" id="num-right">
      <span class="num-label">what it actually is</span>
      <span class="num-value">${esc(rightNumber)}</span>
      <span class="num-src">from ANALYTICS.MARTS.FCT_ORDERS</span>
    </div>
  </div>
  ${
    price
      ? `<p class="delta-line">No. It came from the wrong table — <strong>${esc(usd(price.deltaUsd))}</strong> wrong, ${price.deltaPct.toFixed(2)}% overstated.</p>`
      : ""
  }
  <p class="sub">Five tables in this catalog answer to <code>orders</code>. canon works out which one is
  the real one from the context graph, writes the ruling back into DataHub, and retires the impostor
  so nobody asks twice.</p>
</header>

<section class="stage" id="stage">
  <div class="stage-head">
    <h2>The adjudication</h2>
    <div class="controls">
      <button id="play" class="btn">▶ Play</button>
      <button id="step" class="btn btn-ghost">Step</button>
      <button id="reset" class="btn btn-ghost">Reset</button>
      <span class="beat-label" id="beat-label">ready</span>
    </div>
  </div>

  <div class="chips" id="chips"></div>

  <div class="neighbourhood">
    <div class="nb-head">
      <span class="nb-title">the lineage neighbourhood</span>
      <span class="nb-key">
        <span class="k k-transformed">TRANSFORMED</span>
        <span class="k k-copy">COPY</span>
        <span class="k k-win">canonical</span>
      </span>
    </div>
    <svg id="lineage" viewBox="0 0 960 260" preserveAspectRatio="xMidYMid meet" role="img"
         aria-label="Lineage graph of the candidate tables, assembled as evidence lands"></svg>
  </div>

  <div class="board" id="board"></div>

  <div class="verdict" id="verdict" hidden>
    <div class="verdict-head">
      <span class="verdict-tag" id="verdict-tag">RESOLVED</span>
      <span class="verdict-mech" id="verdict-mech"></span>
    </div>
    <p class="verdict-text" id="verdict-text"></p>
  </div>
</section>

<section class="panel">
  <h2>What the obvious strategies would have picked</h2>
  <p class="lede">Not straw men. These are what a name-matching agent, a "use the freshest table"
  rule, and the social-proof rule actually do today. Same catalog, same question.</p>
  <table class="baselines" id="baselines"></table>
</section>

<section class="panel">
  <h2>Why the wrong number was wrong</h2>
  ${
    price
      ? `<p class="lede">Both figures are <code>SELECT</code>s against a DuckDB warehouse built from a fixed seed
      (${esc(price.engine)}, seed ${price.seed}) — not an estimate.</p>
      <div class="causes">
        <div class="cause"><span class="cause-n">${price.causes.missingDays}</span><span>days of orders missing — the staging copy stopped loading</span></div>
        <div class="cause"><span class="cause-n">${price.causes.testOrdersIncluded.toLocaleString()}</span><span>internal test orders counted as revenue</span></div>
        <div class="cause"><span class="cause-n">${esc(usd(price.causes.refundsNotNettedUsd))}</span><span>of refunds never netted off</span></div>
      </div>
      <details class="sql"><summary>The two queries</summary>
        <pre><code>-- the deck's number, from the staging copy
${esc(price.wrong.query)}
-- ${esc(usd(price.wrong.revenueUsd))}

-- the same question, from the canonical table
${esc(price.canonical.query)}
-- ${esc(usd(price.canonical.revenueUsd))}</code></pre>
      </details>`
      : `<p class="lede">Run <code>npm run price</code> to compute this.</p>`
  }
</section>

<section class="panel">
  <h2>What canon wrote back</h2>
  <p class="lede">A ruling that stays in the agent is worth nothing to the next person who asks.
  Every write below names the transport that actually carried it.</p>
  <ul class="receipts" id="receipts"></ul>
  <p class="verify" id="verify"></p>
  <p class="ask-twice" id="ask-twice"></p>
</section>

<section class="panel panel-abstain">
  <h2>And when it refuses</h2>
  <p class="lede">The same engine, asked <em>"what is our daily revenue?"</em>. Two tables, same grain,
  both current, both owned, both documented — and they measure different things.</p>
  <div class="abstain" id="abstain"></div>
</section>

<footer>
  <p><strong>canon</strong> · ${data.stats.entities} entities across ${data.stats.platforms} platforms ·
  the ruling is computed by the weighted rule table in <code>src/agent/rules.ts</code>, with no model call on any path.
  ${data.mode === "mock" ? "This page was rendered from the committed fixture catalog." : "This page was rendered from a live DataHub OSS instance."}</p>
</footer>

<script id="canon-data" type="application/json">${payload(data).replace(/</g, "\\u003c")}</script>
<script>${JS}</script>
</body></html>`;
}

const CSS = `
:root {
  --bg: #0b0e14; --panel: #121722; --line: #212836; --ink: #e6ebf5; --dim: #8b97ad;
  --win: #35d07f; --lose: #ff6b6b; --warn: #ffcc66; --accent: #6aa9ff; --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink);
  font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  padding-bottom: 64px; }
h1, h2 { line-height: 1.15; margin: 0 0 12px; }
h1 { font-size: clamp(28px, 5vw, 52px); letter-spacing: -0.02em; }
h2 { font-size: 22px; letter-spacing: -0.01em; }
code { font-family: var(--mono); font-size: 0.92em; }
.lede { color: var(--dim); max-width: 76ch; margin: 0 0 20px; }

/* The diegetic rail: always says which URN and aspect is in play. */
.rail { position: fixed; bottom: 0; left: 0; right: 0; z-index: 50;
  display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
  background: #070a10; border-top: 1px solid var(--line); padding: 8px 16px;
  font-family: var(--mono); font-size: 11.5px; color: var(--dim); }
.rail-k { color: #5c678a; text-transform: uppercase; letter-spacing: .08em; }
.rail-urn { color: var(--accent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: min(52vw, 640px); }
.rail-aspect { color: var(--warn); }
.rail-mode { margin-left: auto; color: #5c678a; }

.hero { padding: 56px 20px 32px; max-width: 1100px; margin: 0 auto; }
.clock { font-family: var(--mono); color: var(--warn); letter-spacing: .18em;
  text-transform: uppercase; font-size: 12px; margin: 0 0 10px; }
.numbers { display: flex; align-items: stretch; gap: 16px; flex-wrap: wrap; margin: 28px 0 8px; }
.num { background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
  padding: 16px 20px; display: flex; flex-direction: column; gap: 4px; min-width: 260px; flex: 1; }
.num-label { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--dim); }
.num-value { font-family: var(--mono); font-size: clamp(22px, 3.4vw, 34px); font-weight: 600; }
.num-src { font-family: var(--mono); font-size: 11.5px; color: var(--dim); }
.num-wrong .num-value { color: var(--lose); text-decoration: line-through; text-decoration-thickness: 2px; }
.num-right .num-value { color: var(--win); }
.num-arrow { align-self: center; color: var(--dim); font-size: 26px; }
.delta-line { font-size: 18px; margin: 12px 0 0; }
.delta-line strong { color: var(--lose); font-family: var(--mono); }
.sub { color: var(--dim); max-width: 74ch; margin-top: 18px; }

.stage, .panel { max-width: 1100px; margin: 0 auto; padding: 28px 20px; border-top: 1px solid var(--line); }
.stage-head { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; flex-wrap: wrap; }
.controls { display: flex; gap: 8px; align-items: center; }
.btn { background: var(--accent); color: #06101f; border: 0; border-radius: 8px;
  padding: 7px 14px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
.btn-ghost { background: transparent; color: var(--dim); border: 1px solid var(--line); }
.btn:hover { filter: brightness(1.1); }
.beat-label { font-family: var(--mono); font-size: 11.5px; color: var(--dim); min-width: 15ch; }

/* Mute-proof state-delta chips. */
.chips { display: flex; gap: 10px; flex-wrap: wrap; margin: 18px 0 22px; min-height: 34px; }
.chip { font-family: var(--mono); font-size: 12px; padding: 6px 12px; border-radius: 999px;
  border: 1px solid var(--line); background: var(--panel); color: var(--dim);
  opacity: 0; transform: translateY(6px); transition: opacity .35s, transform .35s; }
.chip.on { opacity: 1; transform: none; }
.chip b { color: var(--ink); }
.chip.good b { color: var(--win); }
.chip.bad b { color: var(--lose); }

/* The lineage neighbourhood: the graph depth, on screen, as it is read. */
.neighbourhood { background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
  padding: 14px 16px 6px; margin-bottom: 14px; }
.nb-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.nb-title { font-family: var(--mono); font-size: 11.5px; text-transform: uppercase;
  letter-spacing: .08em; color: var(--dim); }
.nb-key { display: flex; gap: 12px; font-family: var(--mono); font-size: 10.5px; }
.k::before { content: "—"; margin-right: 5px; font-weight: 700; }
.k-transformed { color: var(--accent); }
.k-copy { color: var(--warn); }
.k-copy::before { content: "--"; }
.k-win { color: var(--win); }
.k-win::before { content: "●"; }
#lineage { width: 100%; height: auto; display: block; }
#lineage .edge { stroke-width: 1.6; fill: none; opacity: 0; transition: opacity .5s; }
#lineage .edge.on { opacity: .75; }
#lineage .edge-transformed { stroke: var(--accent); }
#lineage .edge-copy { stroke: var(--warn); stroke-dasharray: 5 4; }
#lineage .node { opacity: 0; transition: opacity .45s, transform .45s; }
#lineage .node.on { opacity: 1; }
#lineage .node.dim { opacity: .3; }
#lineage .node-box { fill: #161c28; stroke: var(--line); stroke-width: 1.2; rx: 7; }
#lineage .node.win .node-box { fill: rgba(53,208,127,.12); stroke: var(--win); stroke-width: 2; }
#lineage .node.neg .node-box { stroke: rgba(255,107,107,.45); }
#lineage .node-name { fill: var(--ink); font-family: var(--mono); font-size: 11px; }
#lineage .node.win .node-name { fill: var(--win); }
#lineage .node-sub { fill: var(--dim); font-family: var(--mono); font-size: 9.5px; }
#lineage .node-score { font-family: var(--mono); font-size: 12px; font-weight: 700; fill: var(--dim); }
#lineage .node.win .node-score { fill: var(--win); }
#lineage .node.neg .node-score { fill: var(--lose); }
#lineage .layer-label { fill: #47506b; font-family: var(--mono); font-size: 9.5px;
  text-transform: uppercase; letter-spacing: .1em; }

.board { display: grid; gap: 10px; }
.cand { background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
  padding: 14px 16px; opacity: .28; transition: opacity .45s, border-color .45s, transform .45s, box-shadow .45s; }
.cand.seen { opacity: 1; }
.cand.dim { opacity: .32; }
.cand.win { border-color: var(--win); box-shadow: 0 0 0 1px rgba(53,208,127,.35), 0 8px 28px rgba(53,208,127,.12); opacity: 1; }
.cand-top { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; flex-wrap: wrap; }
.cand-name { font-family: var(--mono); font-size: 13.5px; }
.cand-meta { font-family: var(--mono); font-size: 11.5px; color: var(--dim); }
.cand-score { font-family: var(--mono); font-size: 20px; font-weight: 600; min-width: 5ch; text-align: right; }
.cand.win .cand-score { color: var(--win); }
.bar { height: 6px; background: #1b2130; border-radius: 999px; margin: 10px 0 8px; overflow: hidden; }
.bar-fill { height: 100%; width: 0; border-radius: 999px; background: var(--accent); transition: width .6s cubic-bezier(.22,.8,.3,1); }
.cand.win .bar-fill { background: var(--win); }
.cand.neg .bar-fill { background: var(--lose); }
.rules { display: flex; flex-wrap: wrap; gap: 6px; }
.rule { font-family: var(--mono); font-size: 11px; padding: 3px 8px; border-radius: 6px;
  background: #161c28; border: 1px solid var(--line); color: var(--dim);
  opacity: 0; transform: translateY(4px); transition: opacity .3s, transform .3s; }
.rule.on { opacity: 1; transform: none; }
.rule.pos { border-color: rgba(53,208,127,.35); color: #9fe9c2; }
.rule.neg { border-color: rgba(255,107,107,.3); color: #ffb3b3; }
.trap-why { font-size: 12.5px; color: var(--dim); margin-top: 8px; }

.verdict { margin-top: 22px; border: 1px solid var(--win); border-radius: 12px; padding: 16px 18px;
  background: rgba(53,208,127,.06); }
.verdict-head { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
.verdict-tag { font-family: var(--mono); font-weight: 700; color: var(--win); letter-spacing: .1em; }
.verdict-mech { font-family: var(--mono); font-size: 11.5px; color: var(--dim); }
.verdict-text { margin: 10px 0 0; }

.baselines { width: 100%; border-collapse: collapse; font-size: 14px; }
.baselines td { padding: 10px 8px; border-top: 1px solid var(--line); vertical-align: top; }
.baselines .b-name { font-family: var(--mono); font-size: 12.5px; white-space: nowrap; }
.baselines .b-pick { font-family: var(--mono); font-size: 12.5px; color: var(--lose); }
.baselines .b-pick.ok { color: var(--win); }
.baselines .b-verdict { font-family: var(--mono); font-size: 11.5px; text-align: right; white-space: nowrap; }
.baselines .b-why { color: var(--dim); font-size: 13px; }

.causes { display: flex; gap: 12px; flex-wrap: wrap; margin: 6px 0 18px; }
.cause { background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
  padding: 14px 16px; flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 4px; }
.cause-n { font-family: var(--mono); font-size: 24px; font-weight: 600; color: var(--warn); }
.cause span:last-child { color: var(--dim); font-size: 13.5px; }
.sql summary { cursor: pointer; color: var(--dim); font-size: 13.5px; }
.sql pre { background: #0a0d13; border: 1px solid var(--line); border-radius: 10px;
  padding: 14px; overflow-x: auto; font-size: 12px; }

.receipts { list-style: none; padding: 0; margin: 0 0 14px; display: grid; gap: 8px; }
.receipts li { background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
  padding: 10px 14px; display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
.r-ok { color: var(--win); font-family: var(--mono); font-size: 12px; }
.r-via { font-family: var(--mono); font-size: 11.5px; color: var(--accent); }
.r-sum { font-size: 13.5px; }
.verify { font-family: var(--mono); font-size: 12.5px; color: var(--win); }
.ask-twice { color: var(--dim); font-size: 14px; }

.panel-abstain { border-top-color: var(--warn); }
.abstain { display: grid; gap: 10px; }
.ab-card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
.ab-name { font-family: var(--mono); font-size: 13px; color: var(--warn); }
.ab-desc { color: var(--dim); font-size: 13.5px; margin: 6px 0; }
.ab-cols { font-family: var(--mono); font-size: 11.5px; color: var(--dim); }
.ab-verdict { margin-top: 14px; border: 1px solid var(--warn); border-radius: 12px; padding: 14px 16px;
  background: rgba(255,204,102,.06); }
.ab-tag { font-family: var(--mono); font-weight: 700; color: var(--warn); letter-spacing: .1em; }
.ab-missing { margin: 10px 0 0; padding-left: 20px; color: var(--dim); font-size: 13.5px; }

footer { max-width: 1100px; margin: 0 auto; padding: 26px 20px 40px; color: var(--dim); font-size: 13px;
  border-top: 1px solid var(--line); }

@media (prefers-reduced-motion: reduce) {
  .chip, .rule, .cand, .bar-fill { transition: none !important; }
}
`;

const JS = `
(function () {
  var D = JSON.parse(document.getElementById("canon-data").textContent);
  var railUrn = document.getElementById("rail-urn");
  var railAspect = document.getElementById("rail-aspect");
  var board = document.getElementById("board");
  var chips = document.getElementById("chips");
  var beatLabel = document.getElementById("beat-label");
  var verdict = document.getElementById("verdict");

  function setRail(urn, aspect) {
    if (urn) railUrn.textContent = urn;
    if (aspect) railAspect.textContent = aspect;
  }

  var maxAbs = Math.max.apply(null, D.scores.map(function (s) { return Math.abs(s.total); }).concat([1]));

  // Candidate cards, in the order the rule table ranked them.
  var cards = {};
  D.scores.forEach(function (s) {
    var ev = D.evidence.filter(function (e) { return e.urn === s.urn; })[0] || {};
    var el = document.createElement("div");
    el.className = "cand";
    el.setAttribute("data-urn", s.urn);
    var meta = [];
    if (ev.rows != null) meta.push(ev.rows.toLocaleString() + " rows");
    if (ev.staleDays != null) meta.push(ev.staleDays.toFixed(1) + "d since write");
    meta.push(ev.owners + (ev.owners === 1 ? " owner" : " owners"));
    if (ev.humanQueries != null) meta.push(ev.humanQueries + " human queries/30d");
    if (ev.deprecated) meta.push("DEPRECATED");
    el.innerHTML =
      '<div class="cand-top"><span class="cand-name">' + s.label + "</span>" +
      '<span class="cand-score" data-score>—</span></div>' +
      '<div class="cand-meta">' + meta.join("  ·  ") + "</div>" +
      '<div class="bar"><div class="bar-fill"></div></div>' +
      '<div class="rules"></div>' +
      '<div class="trap-why"></div>';
    board.appendChild(el);
    cards[s.urn] = el;
  });

  // ---- lineage neighbourhood -------------------------------------------
  //
  // Laid out by derivation depth read off upstreamLineage: a node sits one
  // column right of the deepest thing it derives from. That is the argument the
  // rule table makes, drawn: the raw table is on the left because everything
  // comes from it, and the canonical table is on the right because business
  // logic has been applied by the time you reach it.
  var SVG_NS = "http://www.w3.org/2000/svg";
  var svg = document.getElementById("lineage");
  var inSet = {};
  D.evidence.forEach(function (e) { inSet[e.urn] = e; });

  function depthOf(urn, guard) {
    var e = inSet[urn];
    if (!e || (guard || 0) > 8) return 0;
    var ups = (e.upstreams || []).filter(function (u) { return inSet[u.urn]; });
    if (!ups.length) return 0;
    var max = 0;
    ups.forEach(function (u) { max = Math.max(max, depthOf(u.urn, (guard || 0) + 1) + 1); });
    return max;
  }

  var LAYER_NAME = ["source", "landing", "modelled", "materialised", "downstream"];
  var byDepth = {};
  D.evidence.forEach(function (e) {
    var d = depthOf(e.urn);
    (byDepth[d] = byDepth[d] || []).push(e);
  });
  var depths = Object.keys(byDepth).map(Number).sort(function (a, b) { return a - b; });

  var BOX_W = 186, BOX_H = 46, GAP_Y = 20;
  var colX = {};
  var spanX = depths.length > 1 ? (960 - BOX_W - 40) / (depths.length - 1) : 0;
  depths.forEach(function (d, i) { colX[d] = 20 + i * spanX; });

  var pos = {};
  depths.forEach(function (d) {
    var col = byDepth[d];
    var totalH = col.length * BOX_H + (col.length - 1) * GAP_Y;
    var top = (260 - totalH) / 2;
    col.forEach(function (e, i) {
      pos[e.urn] = { x: colX[d], y: top + i * (BOX_H + GAP_Y) };
    });
  });

  function el(name, attrs) {
    var n = document.createElementNS(SVG_NS, name);
    Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  // Column labels first, so they sit behind everything.
  depths.forEach(function (d) {
    var label = el("text", { x: colX[d], y: 14, class: "layer-label" });
    label.textContent = LAYER_NAME[Math.min(d, LAYER_NAME.length - 1)];
    svg.appendChild(label);
  });

  // Edges before nodes so the boxes paint over the lines.
  var edgeEls = [];
  D.evidence.forEach(function (e) {
    (e.upstreams || []).forEach(function (u) {
      var from = pos[u.urn], to = pos[e.urn];
      if (!from || !to) return;
      var x1 = from.x + BOX_W, y1 = from.y + BOX_H / 2;
      var x2 = to.x, y2 = to.y + BOX_H / 2;
      var mid = (x1 + x2) / 2;
      var p = el("path", {
        d: "M" + x1 + "," + y1 + " C" + mid + "," + y1 + " " + mid + "," + y2 + " " + x2 + "," + y2,
        class: "edge " + (u.type === "COPY" ? "edge-copy" : "edge-transformed"),
      });
      svg.appendChild(p);
      edgeEls.push(p);
    });
  });

  var nodeEls = {};
  D.evidence.forEach(function (e) {
    var p = pos[e.urn];
    var g = el("g", { class: "node", transform: "translate(" + p.x + "," + p.y + ")" });
    g.appendChild(el("rect", { class: "node-box", width: BOX_W, height: BOX_H }));
    var leaf = e.label.split(":").pop().split(".").pop();
    var name = el("text", { class: "node-name", x: 10, y: 19 });
    name.textContent = leaf.length > 22 ? leaf.slice(0, 21) + "…" : leaf;
    g.appendChild(name);
    var sub = el("text", { class: "node-sub", x: 10, y: 34 });
    sub.textContent = e.platform + (e.staleDays != null ? "  ·  " + e.staleDays.toFixed(1) + "d" : "");
    g.appendChild(sub);
    var score = el("text", { class: "node-score", x: BOX_W - 10, y: 28, "text-anchor": "end" });
    score.textContent = "";
    g.appendChild(score);
    svg.appendChild(g);
    nodeEls[e.urn] = { g: g, score: score };
  });

  function chip(text, kind) {
    var c = document.createElement("span");
    c.className = "chip " + (kind || "");
    c.innerHTML = text;
    chips.appendChild(c);
    requestAnimationFrame(function () { c.classList.add("on"); });
    return c;
  }

  // Beats. Each one leaves a number on screen that changed.
  var beats = [];

  beats.push({
    label: "search",
    run: function () {
      setRail("urn:li:dataset:(urn:li:dataPlatform:*)", "search");
      chip("<b>" + D.stats.entities + "</b> entities searched");
      chip("<b>" + D.scores.length + "</b> candidates answer to the same name");
      Object.keys(cards).forEach(function (u) { cards[u].classList.add("seen"); });
      // The neighbourhood assembles: nodes first, then the edges between them.
      var scored = {};
      D.scores.forEach(function (s) { scored[s.urn] = true; });
      Object.keys(nodeEls).forEach(function (u, i) {
        setTimeout(function () { nodeEls[u].g.classList.add("on"); }, 60 * i);
        // A candidate with no readable schema is set aside rather than ruled on,
        // and saying so is better than an empty box.
        if (!scored[u]) {
          nodeEls[u].score.textContent = "no schema";
          nodeEls[u].score.setAttribute("font-size", "9");
        }
      });
      edgeEls.forEach(function (p, i) {
        setTimeout(function () { p.classList.add("on"); }, 260 + 70 * i);
      });
    }
  });

  D.scores.forEach(function (s) {
    beats.push({
      label: "score " + s.label.split(":").pop(),
      run: function () {
        var el = cards[s.urn];
        setRail(s.urn, "ownership · deprecation · assertionRunEvent · operation");
        el.querySelector("[data-score]").textContent = (s.total > 0 ? "+" : "") + s.total;
        // The same number lands on the graph node, so the two views agree.
        var n = nodeEls[s.urn];
        if (n) {
          n.score.textContent = (s.total > 0 ? "+" : "") + s.total;
          if (s.total < 0) n.g.classList.add("neg");
        }
        var fill = el.querySelector(".bar-fill");
        fill.style.width = Math.max(3, Math.round((Math.abs(s.total) / maxAbs) * 100)) + "%";
        if (s.total < 0) el.classList.add("neg");
        var rules = el.querySelector(".rules");
        rules.innerHTML = "";
        s.hits.forEach(function (h, i) {
          var r = document.createElement("span");
          r.className = "rule " + (h.delta > 0 ? "pos" : "neg");
          r.textContent = (h.delta > 0 ? "+" : "") + h.delta + "  " + h.rule;
          r.title = h.because;
          rules.appendChild(r);
          setTimeout(function () { r.classList.add("on"); }, 40 * i);
        });
      }
    });
  });

  beats.push({
    label: "ruling",
    run: function () {
      var winner = D.ruling.canonical;
      setRail(winner || "—", "structuredProperties (canon.*)");
      Object.keys(cards).forEach(function (u) {
        if (u === winner) cards[u].classList.add("win");
        else cards[u].classList.add("dim");
      });
      Object.keys(nodeEls).forEach(function (u) {
        nodeEls[u].g.classList.add(u === winner ? "win" : "dim");
      });
      D.ruling.traps.forEach(function (t) {
        var el = cards[t.urn];
        if (el) el.querySelector(".trap-why").textContent = "[" + t.severity + "] " + t.why;
      });
      chip("<b>" + D.scores.length + "</b> candidates → <b class=\\"" + "" + "\\">1</b> ruling", "good");
      var margin = D.scores.length > 1 ? D.scores[0].total - D.scores[1].total : null;
      if (margin != null) chip("margin <b>" + margin + "</b> vs threshold " + D.thresholds.decisiveMargin, "good");
      verdict.hidden = false;
      document.getElementById("verdict-tag").textContent = D.ruling.outcome;
      document.getElementById("verdict-mech").textContent =
        D.ruling.mechanism.verdict + " — " + D.ruling.mechanism.detail;
      document.getElementById("verdict-text").textContent = D.ruling.rationale;
    }
  });

  beats.push({
    label: "write-back",
    run: function () {
      setRail(D.ruling.canonical || "—", "add_structured_properties · save_document · deprecation");
      var applied = D.receipts.filter(function (r) { return r.applied; }).length;
      chip("<b>" + applied + "</b> writes applied to DataHub", "good");
      if (D.verified) chip("read back from the graph: <b>VERIFIED</b>", "good");
      chip("second ask costs <b>" + D.second.reads + "</b> graph read" + (D.second.reads === 1 ? "" : "s"), "good");
    }
  });

  var i = 0;
  var timer = null;

  function step() {
    if (i >= beats.length) { stop(); beatLabel.textContent = "done"; return; }
    var b = beats[i++];
    beatLabel.textContent = b.label;
    b.run();
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    document.getElementById("play").textContent = "▶ Play";
  }
  function play() {
    if (timer) { stop(); return; }
    if (i >= beats.length) reset();
    document.getElementById("play").textContent = "❚❚ Pause";
    step();
    timer = setInterval(function () {
      if (i >= beats.length) { stop(); beatLabel.textContent = "done"; return; }
      step();
    }, 1100);
  }
  function reset() {
    stop();
    i = 0;
    chips.innerHTML = "";
    verdict.hidden = true;
    beatLabel.textContent = "ready";
    Object.keys(cards).forEach(function (u) {
      var el = cards[u];
      el.className = "cand";
      el.querySelector("[data-score]").textContent = "—";
      el.querySelector(".bar-fill").style.width = "0";
      el.querySelector(".rules").innerHTML = "";
      el.querySelector(".trap-why").textContent = "";
    });
    Object.keys(nodeEls).forEach(function (u) {
      nodeEls[u].g.setAttribute("class", "node");
      nodeEls[u].score.textContent = "";
    });
    edgeEls.forEach(function (p) { p.classList.remove("on"); });
    setRail("urn:li:dataset:(urn:li:dataPlatform:…)", "—");
  }

  document.getElementById("play").addEventListener("click", play);
  document.getElementById("step").addEventListener("click", function () { stop(); step(); });
  document.getElementById("reset").addEventListener("click", reset);

  // Baselines
  var bt = document.getElementById("baselines");
  var rows = [{ name: "canon", describes: "Weighted evidence over the context graph",
                label: D.ruling.canonicalLabel, correct: true, because: D.ruling.mechanism.detail }]
    .concat(D.baselines);
  rows.forEach(function (b) {
    var tr = document.createElement("tr");
    tr.innerHTML =
      '<td class="b-name">' + b.name + "</td>" +
      '<td class="b-pick' + (b.correct ? " ok" : "") + '">' + (b.label || "nothing") + "</td>" +
      '<td class="b-why">' + (b.describes || "") + "<br><span style=\\"opacity:.7\\">" + (b.because || "") + "</span></td>" +
      '<td class="b-verdict" style="color:' + (b.correct ? "var(--win)" : "var(--lose)") + '">' +
      (b.correct ? "CORRECT" : "WRONG") + "</td>";
    bt.appendChild(tr);
  });

  // Receipts
  var rl = document.getElementById("receipts");
  D.receipts.forEach(function (r) {
    var li = document.createElement("li");
    li.innerHTML = '<span class="r-ok">' + (r.applied ? "✓" : "✗") + "</span>" +
      '<span class="r-sum">' + r.summary + "</span>" +
      '<span class="r-via" style="margin-left:auto">' + r.via + "</span>";
    rl.appendChild(li);
  });
  document.getElementById("verify").textContent = D.verification || "";
  document.getElementById("ask-twice").textContent =
    "Ask the same question again and the catalog answers it: " + D.second.answeredBy +
    ", " + D.second.reads + " graph read" + (D.second.reads === 1 ? "" : "s") + ", no adjudication at all.";

  // Abstain
  var ab = document.getElementById("abstain");
  D.abstain.candidates.forEach(function (c) {
    var d = document.createElement("div");
    d.className = "ab-card";
    d.innerHTML = '<div class="ab-name">' + c.label + "</div>" +
      '<div class="ab-desc">' + c.description + "</div>" +
      '<div class="ab-cols">' + c.columns.join(", ") + "</div>";
    ab.appendChild(d);
  });
  var v = document.createElement("div");
  v.className = "ab-verdict";
  v.innerHTML = '<span class="ab-tag">ABSTAIN</span> ' +
    '<span style="font-family:var(--mono);font-size:11.5px;color:var(--dim)">' +
    D.abstain.mechanism.verdict + " — " + D.abstain.mechanism.detail + "</span>" +
    "<p style=\\"margin:10px 0 0\\">" + D.abstain.rationale + "</p>" +
    '<ul class="ab-missing">' + D.abstain.missing.map(function (m) { return "<li>" + m + "</li>"; }).join("") + "</ul>";
  ab.appendChild(v);
})();
`;
