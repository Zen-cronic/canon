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

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolveResult } from "../agent/resolve.ts";
import { shortUrn } from "../agent/writeback.ts";
import { THRESHOLDS } from "../agent/rules.ts";
import type { DownstreamDelta } from "../eval/downstream.ts";
import type { Posture } from "../eval/coverage.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "..", "out");
const FONT_ROOT = join(HERE, "..", "..", "node_modules", "@fontsource");

/** Keep the judge-facing artifact genuinely self-contained, custom type and all. */
const fontFace = (family: string, weight: number, file: string): string =>
  `@font-face{font-family:"${family}";font-style:normal;font-display:swap;font-weight:${weight};src:url(data:font/woff2;base64,${readFileSync(file).toString("base64")}) format("woff2")}`;

const FONT_CSS = [
  fontFace("Sora", 600, join(FONT_ROOT, "sora", "files", "sora-latin-600-normal.woff2")),
  fontFace("Sora", 700, join(FONT_ROOT, "sora", "files", "sora-latin-700-normal.woff2")),
  fontFace("IBM Plex Sans", 400, join(FONT_ROOT, "ibm-plex-sans", "files", "ibm-plex-sans-latin-400-normal.woff2")),
  fontFace("IBM Plex Sans", 500, join(FONT_ROOT, "ibm-plex-sans", "files", "ibm-plex-sans-latin-500-normal.woff2")),
  fontFace("IBM Plex Sans", 600, join(FONT_ROOT, "ibm-plex-sans", "files", "ibm-plex-sans-latin-600-normal.woff2")),
].join("\n");

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

/**
 * The falsification beat, computed by re-running the shipped adjudicator against
 * a poisoned copy of the catalog. Absent in live mode — a demo should not mutate
 * a real catalog to make a point — and the panel simply does not render.
 */
export type WhatIf = {
  target: string;
  targetLabel: string;
  /** What was broken, in the order it was applied. */
  changes: string[];
  before: { total: number | null; canonicalLabel: string | null };
  after: {
    total: number | null;
    canonical: string | null;
    canonicalLabel: string | null;
    outcome: string;
    /** Only the rules that fired against the poisoned winner. */
    hits: Array<{ rule: string; delta: number; because: string }>;
  };
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
  /** Before/after retrieval measurement. Absent if the demo skipped it. */
  downstream?: DownstreamDelta[] | undefined;
  /** Every contested subject in the catalog, and what canon did with each. */
  posture?: Posture | undefined;
  /** Break the winner, re-run, watch the ruling move. Mock mode only. */
  whatIf?: WhatIf | undefined;
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
    whatIf: data.whatIf ?? null,
    trace: data.hero.trace,
    baselines: data.hero.baselines.map((b) => ({
      name: b.baseline,
      describes: b.describes,
      pick: b.pick,
      label: b.pick ? shortUrn(b.pick) : "nothing",
      because: b.because,
      correct: b.pick === data.hero.ruling.canonical || b.pick === data.hero.ruling.queryThis,
    })),
    plan: (data.hero.plan?.summary ?? []),
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
    downstream: (data.downstream ?? []).map((d) => ({
      subject: d.question.subject,
      question: d.question.question,
      groundTruth: d.question.groundTruth,
      hasAnswer: d.question.acceptable.length > 0,
      trapLabel: d.question.trap ? shortUrn(d.question.trap) : null,
      strategies: d.before.map((b) => {
        const a = d.after.find((s) => s.strategy === b.strategy);
        return {
          id: b.strategy,
          describes: b.describes,
          correctBefore: b.rankOfCorrect,
          correctAfter: a?.rankOfCorrect ?? null,
          trapBefore: b.trapRank,
          trapAfter: a?.trapRank ?? null,
          offeredBefore: b.offeredCount,
          offeredAfter: a?.offeredCount ?? 0,
          pickAfter: a?.pick ? shortUrn(a.pick) : null,
        };
      }),
    })),
    posture: data.posture ?? null,
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
<meta name="theme-color" content="#e2e4dd">
<meta name="description" content="canon resolves which data asset is safe to trust and writes the ruling back to DataHub.">
<title>canon — can I send this number to the board?</title>
<style>${CSS}</style>
</head><body>

<a class="skip-link" href="#main-content">Skip to the ruling</a>

<nav class="product-bar" aria-label="Product">
  <a class="brand" href="#main-content" aria-label="canon report home">
    <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
    <span class="brand-copy"><strong>canon</strong><small>catalog adjudicator</small></span>
  </a>
  <div class="product-context" aria-label="Report context">
    <span><i class="context-dot dot-orange"></i>${data.stats.entities} entities</span>
    <b aria-hidden="true">→</b>
    <span><i class="context-dot dot-yellow"></i>${data.stats.platforms} platforms</span>
  </div>
  <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Switch to dark theme" title="Switch color theme">
    <span aria-hidden="true">◐</span>
  </button>
  <a class="nav-action" href="#stage">View the ruling <span aria-hidden="true">↓</span></a>
</nav>

<main id="main-content">

<header class="hero">
  <p class="clock"><span>01</span> Two dashboards, two revenue numbers · the board deck goes out in the morning</p>
  <h1>Can I send this <em>number</em> to the board?</h1>
  <p class="sub">Five tables in this catalog answer to <code>orders</code>. canon follows the context
  graph, chooses the defensible source, writes the ruling back into DataHub, and retires the
  impostor so nobody has to ask twice.</p>
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
</header>

<section class="stage" id="stage">
  <div class="stage-head">
    <div>
      <p class="eyebrow"><span>02</span> Evidence studio</p>
      <h2>Watch the catalog make its case.</h2>
    </div>
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
        <span class="k k-sibling">SIBLING</span>
        <span class="k k-win">canonical</span>
        <span class="k k-assert">assertions pass / fail</span>
      </span>
    </div>
    <svg id="lineage" viewBox="0 0 960 360" preserveAspectRatio="xMidYMid meet" role="img"
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

<section class="panel" data-kicker="03 · Baseline check">
  <h2>What the obvious strategies would have picked</h2>
  <p class="lede">Not straw men. These are what a name-matching agent, a "use the freshest table"
  rule, and the social-proof rule actually do today. Same catalog, same question.</p>
  <table class="baselines" id="baselines"></table>
</section>

<section class="panel" data-kicker="04 · Number audit">
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

<section class="panel" data-kicker="05 · Governed write-back">
  <h2>What canon proposes to write</h2>
  <p class="lede">A ruling that stays in the agent is worth nothing to the next person who asks — so
  canon writes it into DataHub. But deprecating a table other people and agents trust is
  consequential, so canon <strong>plans</strong>, and a human applies.</p>

  <ul class="plan" id="plan"></ul>

  <div class="approve-row" id="approve-row">
    <button id="approve" class="btn btn-approve">Approve — apply to DataHub</button>
    <span class="approve-note">Nothing has been written yet. This is the one decision canon does not make.</span>
  </div>

  <div id="applied" hidden>
    <p class="applied-head">Applied. Every line names the transport that actually carried it.</p>
    <ul class="receipts" id="receipts"></ul>
    <p class="verify" id="verify"></p>
    <p class="ask-twice" id="ask-twice"></p>
  </div>
</section>

<section class="panel" id="panel-posture" data-kicker="06 · Catalog posture">
  <h2>The same engine, over every contested question in the catalog</h2>
  <p class="lede">One hand-picked question is what you would show if it were the only one that
  worked. So: every concept in this catalog that more than one asset answers to, put through the
  same adjudicator, read-only. <strong>Contested</strong> means exactly that — not "unhealthy".
  Catalog health dashboards are a thing DataHub already ships.</p>
  <div class="posture" id="posture"></div>
  <p class="lede">The refusals are the interesting column. canon abstains when the catalog does not
  carry enough to separate the candidates, and each abstention names what would settle it — so the
  refusals are a prioritised metadata backlog rather than a list of failures.</p>
  <ul class="backlog" id="backlog"></ul>
</section>

<section class="panel" id="panel-downstream" data-kicker="07 · Downstream effect">
  <h2>What that changed for the next agent</h2>
  <p class="lede">The write-back only matters if somebody else is better off. So: three stock
  retrieval strategies, run over this same catalog before and after the ruling landed. They read
  <code>search</code> and <code>get_entities</code> and nothing else —
  <code>src/eval/downstream.ts</code> imports none of canon's rules, scorer or resolver.</p>
  <div id="downstream"></div>
  <p class="lede downstream-note">The honest result is in the second row of each block. A
  governance-aware client already ranked the right table first on this catalog — the description,
  the owner and the Certified tag were enough, and the ruling did not have to fix that. What
  changed is that the staging copy behind the wrong board number stopped being served at all.
  A client that reads no metadata is unaffected either way.</p>
</section>

<section class="panel panel-abstain" data-kicker="08 · Failure posture">
  <h2>And when it refuses</h2>
  <p class="lede">The same engine, asked <em>"what is our daily revenue?"</em>. Two tables, same grain,
  both current, both owned, both documented — and they measure different things.</p>
  <div class="abstain" id="abstain"></div>
</section>

</main>

<footer>
  <p><strong>canon</strong> · ${data.stats.entities} entities across ${data.stats.platforms} platforms ·
  the ruling is computed by the weighted rule table in <code>src/agent/rules.ts</code>, with no model call on any path.
  ${data.mode === "mock" ? "This page was rendered from the committed fixture catalog." : "This page was rendered from a live DataHub OSS instance."}</p>
</footer>

<div class="rail" id="rail" role="status" aria-live="polite">
  <span class="rail-k">DataHub</span>
  <span class="rail-urn" id="rail-urn">urn:li:dataset:(urn:li:dataPlatform:…)</span>
  <span class="rail-k">aspect</span>
  <span class="rail-aspect" id="rail-aspect">—</span>
  <span class="rail-mode">${data.mode === "live" ? `live · ${esc(data.serverInfo ?? "DataHub OSS")}` : "fixture catalog"}</span>
</div>

<script id="canon-data" type="application/json">${payload(data).replace(/</g, "\\u003c")}</script>
<script>${JS}</script>
</body></html>`;
}

const CSS = `
${FONT_CSS}
:root {
  color-scheme: light dark;
  --bg: #e2e4dd;
  --panel: #f4f6f4;
  --panel-strong: #ffffff;
  --panel-soft: #eceee9;
  --ink: #040404;
  --dim: #5f6972;
  --line: #9ca8b2;
  --line-soft: #c9cec8;
  --accent: #ff6100;
  --yellow: #ffb200;
  --win: #00802d;
  --lose: #c63838;
  --warn: #9a6500;
  --tie: #5b4fc7;
  --mono: "IBM Plex Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  --sans: "IBM Plex Sans", sans-serif;
  --display: "Sora", sans-serif;
  --radius: 14px;
}
* { box-sizing: border-box; }
html { min-width: 320px; scroll-behavior: smooth; }
body {
  min-width: 320px;
  min-height: 100vh;
  margin: 0;
  padding-bottom: 62px;
  color: var(--ink);
  background-color: var(--bg);
  background-image:
    linear-gradient(to right, rgba(115, 143, 159, .12) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(115, 143, 159, .12) 1px, transparent 1px);
  background-size: 48px 48px;
  font: 400 16px/1.55 var(--sans);
  font-variant-numeric: tabular-nums;
}
button, a { -webkit-tap-highlight-color: transparent; }
button { font: inherit; }
a { color: inherit; }
::selection { color: var(--ink); background: var(--yellow); }
:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
[hidden] { display: none !important; }
h1, h2 { margin: 0; font-family: var(--display); font-weight: 600; }
h1 { max-width: 1120px; margin-inline: auto; font-size: clamp(42px, 7vw, 90px); line-height: .93;
  letter-spacing: -.072em; text-transform: uppercase; text-wrap: balance; }
h1 em { color: var(--accent); font-style: normal; }
h2 { font-size: clamp(26px, 3vw, 38px); line-height: 1.04; letter-spacing: -.045em; text-wrap: balance; }
code { padding: .08em .28em; color: var(--ink); background: var(--panel-soft); border: 1px solid var(--line-soft);
  border-radius: 4px; font-family: var(--mono); font-size: .86em; }
.lede { max-width: 78ch; margin: 0 0 24px; color: var(--dim); }

.skip-link { position: fixed; top: 10px; left: 10px; z-index: 100; padding: 10px 14px;
  color: var(--ink); background: var(--yellow); border: 1px solid var(--ink); border-radius: 8px;
  font-weight: 600; text-decoration: none; transform: translateY(-160%); }
.skip-link:focus { transform: none; }

/* Product chrome mirrors Mux's bounded, outlined header without borrowing its identity. */
.product-bar { position: relative; z-index: 5; display: grid; grid-template-columns: 1fr auto 60px 220px;
  min-height: 78px; max-width: 1360px; margin: 0 auto; background: var(--bg);
  border: 1px solid var(--line); border-top: 0; }
.brand { display: inline-flex; width: fit-content; align-items: center; gap: 13px; padding: 0 28px;
  text-decoration: none; }
.brand-mark { display: grid; width: 38px; height: 38px; grid-template-columns: repeat(3, 1fr); gap: 3px;
  align-items: end; padding: 9px; color: var(--panel-strong); background: var(--ink); border-radius: 10px; }
.brand-mark i { display: block; background: currentColor; border-radius: 2px 2px 0 0; }
.brand-mark i:nth-child(1) { height: 46%; }
.brand-mark i:nth-child(2) { height: 100%; }
.brand-mark i:nth-child(3) { height: 72%; }
.brand-copy { display: grid; line-height: 1; }
.brand-copy strong { font-family: var(--display); font-size: 19px; letter-spacing: -.045em; }
.brand-copy small { margin-top: 6px; color: var(--dim); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
.product-context { display: flex; align-items: center; gap: 16px; padding: 0 28px; color: var(--dim);
  border-left: 1px solid var(--line); font-size: 12px; }
.product-context span { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
.product-context b { color: var(--line); font-weight: 400; }
.context-dot { display: block; width: 8px; height: 8px; border: 1px solid var(--ink); border-radius: 50%; }
.dot-orange { background: var(--accent); }
.dot-yellow { background: var(--yellow); }
.theme-toggle { display: grid; min-width: 60px; padding: 0; place-items: center; color: var(--ink); background: transparent;
  border: 0; border-left: 1px solid var(--line); cursor: pointer; font-size: 19px; transition: background .16s; }
.theme-toggle:hover { background: var(--panel-soft); }
.nav-action { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 0 28px;
  background: var(--yellow); border-left: 1px solid var(--line); font-family: var(--mono); font-size: 12px;
  font-weight: 600; letter-spacing: .08em; text-decoration: none; text-transform: uppercase; transition: background .16s; }
.nav-action:hover { background: var(--accent); }

.hero { max-width: 1360px; margin: 0 auto; padding: clamp(72px, 8vw, 116px) 40px 76px; text-align: center;
  background: rgba(226, 228, 221, .88); border-inline: 1px solid var(--line); }
.clock, .eyebrow, .panel::before { font-family: var(--mono); font-size: 11px; font-weight: 600;
  letter-spacing: .11em; text-transform: uppercase; }
.clock { margin: 0 0 26px; color: var(--dim); }
.clock span, .eyebrow span { margin-right: 8px; color: var(--accent); }
.sub { max-width: 760px; margin: 26px auto 0; color: var(--dim); font-size: clamp(15px, 1.4vw, 18px); }
.numbers { display: grid; grid-template-columns: 1fr 64px 1fr; align-items: stretch; max-width: 1040px;
  margin: 48px auto 0; overflow: hidden; background: var(--panel-strong); border: 1px solid var(--line);
  border-radius: 26px; }
.num { display: flex; min-width: 0; flex-direction: column; gap: 7px; padding: 24px 28px; text-align: left; }
.num-right { background: #edf7ed; }
.num-label { color: var(--dim); font-family: var(--mono); font-size: 10px; font-weight: 600;
  letter-spacing: .1em; text-transform: uppercase; }
.num-value { overflow-wrap: anywhere; font-family: var(--display); font-size: clamp(26px, 3.4vw, 44px);
  font-weight: 600; letter-spacing: -.045em; line-height: 1.15; }
.num-src { overflow: hidden; color: var(--dim); font-family: var(--mono); font-size: 10.5px;
  text-overflow: ellipsis; white-space: nowrap; }
.num-wrong .num-value { color: var(--lose); text-decoration: line-through; text-decoration-thickness: 2px; }
.num-right .num-value { color: var(--win); }
.num-arrow { display: grid; place-items: center; color: var(--ink); background: var(--yellow);
  border-inline: 1px solid var(--line); font-family: var(--mono); font-size: 26px; }
.delta-line { width: fit-content; max-width: 100%; margin: 14px auto 0; padding: 9px 14px;
  color: var(--ink); background: var(--panel); border: 1px solid var(--line); border-radius: 9px; font-size: 15px; }
.delta-line strong { color: var(--lose); font-family: var(--mono); }

/* The graph and score board are one evidence studio: this is the signature surface. */
.stage { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 14px; max-width: 1328px;
  margin: 0 auto 32px; padding: 34px; background: var(--panel-strong); border: 1px solid var(--line);
  border-radius: 28px; box-shadow: 0 14px 0 rgba(4, 4, 4, .08); }
.stage-head { display: flex; grid-column: 1 / -1; justify-content: space-between; align-items: flex-end; gap: 24px; }
.eyebrow { margin: 0 0 8px; color: var(--dim); }
.controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
.btn { min-height: 42px; padding: 9px 18px; color: var(--ink); background: var(--accent); border: 1px solid var(--ink);
  border-radius: 9px; cursor: pointer; font-family: var(--mono); font-size: 11px; font-weight: 600;
  letter-spacing: .06em; text-transform: uppercase; transition: background .16s, color .16s, transform .16s; }
.btn:hover { background: var(--yellow); transform: translateY(-1px); }
.btn-ghost { color: var(--ink); background: transparent; border-color: var(--line); }
.btn-ghost:hover { color: var(--panel-strong); background: var(--ink); }
.beat-label { min-width: 14ch; color: var(--dim); font-family: var(--mono); font-size: 10.5px; text-align: right; }
.chips { display: flex; grid-column: 1 / -1; min-height: 34px; flex-wrap: wrap; gap: 8px; margin: 6px 0 2px; }
.chip { padding: 6px 11px; color: var(--dim); background: var(--panel-soft); border: 1px solid var(--line-soft);
  border-radius: 999px; font-family: var(--mono); font-size: 11px; opacity: 0; transform: translateY(6px);
  transition: opacity .35s, transform .35s; }
.chip.on { opacity: 1; transform: none; }
.chip b { color: var(--ink); }
.chip.good { background: #e8f4e8; border-color: #8cb69a; }
.chip.good b { color: var(--win); }
.chip.bad b { color: var(--lose); }
.neighbourhood { grid-column: span 7; min-width: 0; padding: 16px 18px 8px; background: var(--panel-soft);
  border: 1px solid var(--line); border-radius: var(--radius); }
.nb-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.nb-title { color: var(--ink); font-family: var(--mono); font-size: 10.5px; font-weight: 600;
  letter-spacing: .08em; text-transform: uppercase; }
.nb-key { display: flex; gap: 12px; font-family: var(--mono); font-size: 9.5px; }
.k::before { content: "—"; margin-right: 5px; font-weight: 700; }
.k-transformed { color: var(--accent); }
.k-copy { color: var(--warn); }
.k-copy::before { content: "--"; }
.k-sibling { color: var(--tie); }
.k-sibling::before { content: "="; }
.k-win { color: var(--win); }
.k-assert { color: var(--dim); }
.k-assert::before { content: "●"; color: var(--win); }
.k-win::before { content: "●"; }
#lineage { display: block; width: 100%; height: auto; }
#lineage .edge { fill: none; stroke-width: 1.8; opacity: 0; transition: opacity .5s; }
#lineage .edge.on { opacity: .9; }
#lineage .edge-transformed { stroke: var(--accent); }
#lineage .edge-copy { stroke: var(--warn); stroke-dasharray: 5 4; }
#lineage .node { opacity: 0; transition: opacity .45s, transform .45s; }
#lineage .node.on { opacity: 1; }
#lineage .node.dim { opacity: .58; }
#lineage .node-box { fill: var(--panel-strong); stroke: var(--line); stroke-width: 1.2; rx: 7; }
#lineage .node.win .node-box { fill: #e8f4e8; stroke: var(--win); stroke-width: 2; }
#lineage .node.neg .node-box { fill: #f9eeee; stroke: var(--lose); }
#lineage .node-name { fill: var(--ink); font-family: var(--mono); font-size: 11px; }
#lineage .node.win .node-name { fill: var(--win); }
#lineage .node-sub { fill: var(--dim); font-family: var(--mono); font-size: 9.5px; }
#lineage .node-score { fill: var(--dim); font-family: var(--mono); font-size: 12px; font-weight: 700; }
#lineage .node.win .node-score { fill: var(--win); }
#lineage .node.neg .node-score { fill: var(--lose); }
#lineage .edge-sibling { stroke: var(--tie); stroke-dasharray: 2 3; stroke-width: 2.2; }
#lineage .edge-label { fill: var(--dim); font-family: var(--mono); font-size: 8px; letter-spacing: .04em;
  opacity: 0; transition: opacity .5s; text-anchor: middle; }
#lineage .edge-label.on { opacity: .95; }
#lineage .edge-label.lbl-copy { fill: var(--warn); }
#lineage .edge-label.lbl-transformed { fill: var(--accent); }
#lineage .edge-label.lbl-sibling { fill: var(--tie); }
#lineage .pip { opacity: 0; transition: opacity .4s; }
#lineage .pip.on { opacity: 1; }
#lineage .pip-pass { fill: var(--win); }
#lineage .pip-fail { fill: var(--lose); }
#lineage .node-meta { fill: var(--dim); font-family: var(--mono); font-size: 8.5px; }
#lineage .node-badge { font-family: var(--mono); font-size: 8.5px; font-weight: 700; letter-spacing: .06em;
  fill: var(--win); opacity: 0; transition: opacity .45s; }
#lineage .node-badge.on { opacity: 1; }
#lineage .node.win-sib .node-box { fill: #e8f4e8; stroke: var(--win); stroke-width: 1.6; stroke-dasharray: 4 3; }
#lineage .node.win-sib .node-name { fill: var(--win); }
#lineage .node-strike { stroke: var(--lose); stroke-width: 1.6; opacity: 0; transition: opacity .35s; }
#lineage .node-strike.on { opacity: .75; }
#lineage .layer-label { fill: var(--dim); font-family: var(--mono); font-size: 9.5px;
  letter-spacing: .1em; text-transform: uppercase; }
.board { display: grid; grid-column: span 5; min-width: 0; max-height: 338px; gap: 8px; padding-right: 5px;
  overflow-y: auto; overscroll-behavior: contain; scrollbar-color: var(--line) transparent; scrollbar-width: thin; }
.cand { min-width: 0; padding: 13px 14px; overflow: hidden; background: var(--panel); border: 1px solid var(--line-soft); border-radius: 9px;
  opacity: .34; transition: opacity .45s, border-color .45s, transform .45s, box-shadow .45s; }
.cand.seen { opacity: 1; }
.cand.dim { opacity: .46; }
.cand.win { z-index: 1; border-color: var(--win); box-shadow: 0 0 0 2px rgba(0, 128, 45, .14); opacity: 1; }
.cand-top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.cand-name { min-width: 0; flex: 1; overflow: hidden; font-family: var(--mono); font-size: 11.5px; text-overflow: ellipsis; white-space: nowrap; }
.cand-meta { overflow: hidden; color: var(--dim); font-family: var(--mono); font-size: 9.5px;
  text-overflow: ellipsis; white-space: nowrap; }
.cand-score { min-width: 4ch; font-family: var(--display); font-size: 17px; font-weight: 600; text-align: right; }
.cand.win .cand-score { color: var(--win); }
.bar { height: 4px; margin: 8px 0; overflow: hidden; background: var(--line-soft); border-radius: 999px; }
.bar-fill { width: 0; height: 100%; background: var(--accent); border-radius: 999px;
  transition: width .6s cubic-bezier(.22,.8,.3,1); }
.cand.win .bar-fill { background: var(--win); }
.cand.neg .bar-fill { background: var(--lose); }
.rules { display: flex; flex-wrap: wrap; gap: 5px; }
.rule { padding: 2px 6px; color: var(--dim); background: var(--panel-strong); border: 1px solid var(--line-soft);
  border-radius: 5px; font-family: var(--mono); font-size: 9.5px; opacity: 0; transform: translateY(4px);
  transition: opacity .3s, transform .3s; }
.rule.on { opacity: 1; transform: none; }
.rule.pos { color: var(--win); border-color: #8cb69a; }
.rule.neg { color: var(--lose); border-color: #d7a2a2; }
.trap-why { margin-top: 7px; color: var(--lose); font-size: 11px; }
.verdict { grid-column: 1 / -1; margin-top: 4px; padding: 20px 22px; color: var(--panel-strong);
  background: var(--ink); border: 1px solid var(--ink); border-radius: var(--radius); box-shadow: 8px 8px 0 var(--yellow); }
.verdict-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; }
.verdict-tag { color: #53d77d; font-family: var(--mono); font-weight: 700; letter-spacing: .1em; }
.verdict-mech { min-width: 0; overflow-wrap: anywhere; color: #aeb7bf; font-family: var(--mono); font-size: 10.5px; }
.verdict-text { max-width: 90ch; margin: 10px 0 0; overflow-wrap: anywhere; }

/* Supporting evidence reads as a quiet technical ledger. */
.panel { position: relative; max-width: 1264px; margin: 0 auto; padding: 68px 0; border-top: 1px solid var(--line); }
.panel::before { display: block; margin-bottom: 12px; color: var(--accent); content: attr(data-kicker); }
.panel > h2 { max-width: 820px; margin-bottom: 16px; }
.panel > .lede { font-size: 15px; }
.baselines, .ds-table { width: 100%; overflow: hidden; background: var(--panel-strong); border: 1px solid var(--line);
  border-collapse: separate; border-spacing: 0; border-radius: var(--radius); font-size: 14px; }
.baselines td, .ds-table td { padding: 14px 16px; border-top: 1px solid var(--line-soft); vertical-align: top; }
.baselines tr:first-child td { border-top: 0; }
.baselines .b-name, .baselines .b-pick, .ds-name, .ds-cell { font-family: var(--mono); font-size: 11.5px; }
.baselines .b-name, .ds-name { font-weight: 600; white-space: nowrap; }
.baselines .b-pick { color: var(--lose); }
.baselines .b-pick.ok { color: var(--win); }
.baselines .b-verdict, .ds-verdict { font-family: var(--mono); font-size: 10.5px; text-align: right; white-space: nowrap; }
.baselines .b-why, .ds-desc { color: var(--dim); font-size: 12.5px; }
.posture { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 28px 0 24px;
  overflow: hidden; background: var(--panel-strong); border: 1px solid var(--line); border-radius: var(--radius); }
.p-cell { display: flex; min-width: 0; flex-direction: column; gap: 3px; padding: 20px; border-left: 1px solid var(--line); }
.p-cell:first-child { border-left: 0; }
.p-n { font-family: var(--display); font-size: 36px; font-weight: 600; letter-spacing: -.05em; line-height: 1; }
.p-k { font-size: 13px; font-weight: 600; }
.p-sub { color: var(--dim); font-size: 11.5px; }
.p-win .p-n { color: var(--win); }
.p-warn .p-n { color: var(--warn); }
.p-info .p-n { color: var(--accent); }
.backlog { margin: 12px 0 0; padding: 0; list-style: none; }
.backlog li { display: flex; align-items: baseline; gap: 14px; padding: 10px 0; border-top: 1px solid var(--line); font-size: 13.5px; }
.bl-n { min-width: 3ch; font-family: var(--mono); font-weight: 600; text-align: right; }
.bl-need { color: var(--dim); }
.p-cost { margin-top: 20px; }
.ds-block { margin: 28px 0 10px; }
.ds-q { font-family: var(--display); font-size: 16px; font-weight: 600; }
.ds-gt { margin-top: 3px; color: var(--dim); font-family: var(--mono); font-size: 11px; }
.ds-table { margin-top: 12px; }
.ds-table th { padding: 10px 16px; color: var(--dim); background: var(--panel-soft); font-family: var(--mono);
  font-size: 9.5px; font-weight: 600; letter-spacing: .06em; text-align: left; text-transform: uppercase; }
.ds-desc { max-width: 36ch; margin-top: 3px; font-family: var(--sans); white-space: normal; }
.ds-cell { white-space: nowrap; }
.ds-ar { color: var(--dim); }
.ds-ok { color: var(--win); }
.ds-bad { color: var(--lose); }
.ds-flat { color: var(--dim); }
.downstream-note { margin-top: 20px; }
.causes { display: grid; grid-template-columns: repeat(3, 1fr); margin: 28px 0 20px;
  overflow: hidden; background: var(--panel-strong); border: 1px solid var(--line); border-radius: var(--radius); }
.cause { display: flex; min-width: 0; flex-direction: column; gap: 6px; padding: 22px; border-left: 1px solid var(--line); }
.cause:first-child { border-left: 0; }
.cause-n { color: var(--accent); font-family: var(--display); font-size: 30px; font-weight: 600; letter-spacing: -.04em; }
.cause span:last-child { color: var(--dim); font-size: 13px; }
.sql summary { width: fit-content; cursor: pointer; color: var(--ink); font-family: var(--mono); font-size: 11px;
  font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
.sql pre { padding: 18px; overflow-x: auto; color: #eef2ec; background: #151616; border: 1px solid var(--ink);
  border-radius: 10px; font-size: 11.5px; }
.sql code { padding: 0; color: inherit; background: transparent; border: 0; }
.plan { display: grid; margin: 26px 0 20px; padding: 0; overflow: hidden; background: var(--panel-strong);
  border: 1px solid var(--line); border-radius: var(--radius); list-style: none; }
.plan li { display: flex; align-items: baseline; gap: 12px; padding: 13px 16px; border-top: 1px solid var(--line-soft); font-size: 13.5px; }
.plan li:first-child { border-top: 0; }
.plan li::before { color: var(--dim); content: "○"; font-family: var(--mono); }
.plan li.consequential { background: #fff5d9; }
.plan li.consequential::before { color: var(--warn); content: "!"; font-weight: 700; }
.approve-row { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; margin-bottom: 8px; }
.btn-approve { padding-inline: 22px; color: var(--panel-strong); background: var(--win); border-color: var(--win); }
.approve-row.done .btn-approve { color: var(--dim); background: var(--panel-soft); border-color: var(--line); cursor: default; }
.approve-note { color: var(--dim); font-size: 13px; }
.applied-head { margin: 20px 0 10px; color: var(--win); font-weight: 600; }
.receipts { display: grid; margin: 0 0 14px; padding: 0; overflow: hidden; background: var(--panel-strong);
  border: 1px solid var(--line); border-radius: var(--radius); list-style: none; }
.receipts li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; padding: 12px 16px;
  border-top: 1px solid var(--line-soft); opacity: 0; transform: translateY(4px); transition: opacity .3s, transform .3s; }
.receipts li:first-child { border-top: 0; }
.receipts li.on { opacity: 1; transform: none; }
.r-ok { color: var(--win); font-family: var(--mono); font-size: 12px; }
.r-via { color: var(--accent); font-family: var(--mono); font-size: 10.5px; }
.r-sum { font-size: 13.5px; }
.verify { color: var(--win); font-family: var(--mono); font-size: 11.5px; }
.ask-twice { color: var(--dim); font-size: 14px; }
.abstain { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.ab-card { min-width: 0; padding: 16px 18px; background: var(--panel-strong); border: 1px solid var(--line); border-radius: 10px; }
.ab-name { overflow-wrap: anywhere; color: var(--warn); font-family: var(--mono); font-size: 12px; }
.ab-desc { margin: 6px 0; color: var(--dim); font-size: 13.5px; }
.ab-cols { overflow-wrap: anywhere; color: var(--dim); font-family: var(--mono); font-size: 10.5px; }
.ab-verdict { min-width: 0; grid-column: 1 / -1; margin-top: 4px; padding: 18px; overflow-wrap: anywhere;
  background: #fff5d9; border: 1px solid var(--warn); border-radius: var(--radius); }
.ab-tag { color: var(--warn); font-family: var(--mono); font-weight: 700; letter-spacing: .1em; }
.ab-missing { margin: 10px 0 0; padding-left: 20px; color: var(--dim); font-size: 13.5px; }
footer { max-width: 1360px; margin: 0 auto; padding: 34px 48px 52px; color: var(--dim); background: var(--bg);
  border: 1px solid var(--line); border-bottom: 0; font-size: 12px; }
footer p { margin: 0; }

/* The diegetic provenance rail always says which URN and aspect is in play. */
.rail { position: fixed; right: 0; bottom: 0; left: 0; z-index: 50; display: flex; flex-wrap: wrap;
  align-items: center; gap: 10px; min-height: 38px; padding: 8px 16px; color: #aab2ba;
  background: #0d0e0e; border-top: 1px solid #404548; font-family: var(--mono); font-size: 10.5px; }
.rail-k { color: #7d858c; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
.rail-urn { max-width: min(52vw, 640px); overflow: hidden; color: #ff7830; text-overflow: ellipsis; white-space: nowrap; }
.rail-aspect { color: #ffbf32; }
.rail-mode { margin-left: auto; color: #7d858c; }

@media (max-width: 1100px) {
  .product-bar { margin-inline: 20px; grid-template-columns: 1fr 60px 220px; }
  .product-context { display: none; }
  .hero { margin-inline: 20px; }
  .stage, .panel { margin-inline: 36px; }
  .neighbourhood, .board { grid-column: 1 / -1; }
  .posture { grid-template-columns: repeat(2, 1fr); }
  .p-cell:nth-child(3) { border-left: 0; border-top: 1px solid var(--line); }
  .p-cell:nth-child(4) { border-top: 1px solid var(--line); }
  footer { margin-inline: 20px; }
}
@media (max-width: 720px) {
  body { padding-bottom: 82px; background-size: 32px 32px; }
  .product-bar { min-height: 66px; margin-inline: 10px; grid-template-columns: 1fr 48px auto; }
  .brand { padding: 0 14px; }
  .brand-mark { width: 32px; height: 32px; padding: 8px; }
  .brand-copy small { display: none; }
  .theme-toggle { min-width: 48px; }
  .nav-action { padding: 0 14px; font-size: 10px; }
  .nav-action span { display: none; }
  .hero { margin-inline: 10px; padding: 52px 18px 48px; }
  h1 { font-size: clamp(38px, 13vw, 64px); }
  .numbers { grid-template-columns: 1fr; margin-top: 34px; border-radius: 18px; }
  .num { padding: 20px; }
  .num-arrow { min-height: 44px; border: 0; border-block: 1px solid var(--line); transform: none; }
  .num-arrow { font-size: 0; }
  .num-arrow::after { content: "↓"; font-size: 22px; }
  .delta-line { font-size: 13px; }
  .stage { margin: 0 10px 20px; padding: 20px; border-radius: 18px; box-shadow: 0 8px 0 rgba(4,4,4,.08); }
  .stage-head { align-items: flex-start; flex-direction: column; }
  .controls { justify-content: flex-start; }
  .beat-label { width: 100%; text-align: left; }
  .neighbourhood { overflow-x: auto; }
  #lineage { min-width: 680px; }
  .board { max-height: none; padding-right: 0; overflow: visible; }
  .panel { margin-inline: 20px; padding: 52px 0; }
  .posture, .causes, .abstain { grid-template-columns: 1fr; }
  .p-cell, .p-cell:nth-child(3), .cause { border-left: 0; border-top: 1px solid var(--line); }
  .p-cell:first-child, .cause:first-child { border-top: 0; }
  .ab-verdict { grid-column: 1; }
  .baselines, .ds-table { display: block; overflow-x: auto; }
  .baselines td, .ds-table td, .ds-table th { min-width: 140px; }
  footer { margin-inline: 10px; padding: 28px 20px 44px; }
  .rail { align-content: center; min-height: 58px; }
  .rail-urn { max-width: 58vw; }
  .rail-mode { width: 100%; margin-left: 0; }
}
:root[data-theme="dark"] {
    --bg: #171a1b; --panel: #212526; --panel-strong: #292d2e; --panel-soft: #1c2021;
    --ink: #f0f1ed; --dim: #aab2b8; --line: #69747c; --line-soft: #41494e;
    --win: #39cf6c; --lose: #ff7171; --warn: #ffbd2e;
}
:root[data-theme="dark"] body { background-image: linear-gradient(to right, rgba(156,168,178,.09) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(156,168,178,.09) 1px, transparent 1px); }
:root[data-theme="dark"] .hero { background: rgba(23, 26, 27, .9); }
:root[data-theme="dark"] .num-right,
:root[data-theme="dark"] .chip.good,
:root[data-theme="dark"] #lineage .node.win .node-box { fill: #173421; }
:root[data-theme="dark"] #lineage .node.neg .node-box { fill: #3a2020; }
:root[data-theme="dark"] #lineage .node.win-sib .node-box { fill: #142b1b; }
:root[data-theme="dark"] .plan li.consequential,
:root[data-theme="dark"] .ab-verdict { background: #392f14; }
:root[data-theme="dark"] .verdict { color: #f4f6f4; background: #040404; }
:root[data-theme="dark"] .btn-approve { color: #07130a; }
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { transition-duration: .01ms !important; animation-duration: .01ms !important; }
}
`;

const JS = `
(function () {
  var D = JSON.parse(document.getElementById("canon-data").textContent);
  const root = document.documentElement;
  const themeButton = document.getElementById("theme-toggle");
  let storedTheme = "light";
  try { storedTheme = localStorage.getItem("canon-theme") || "light"; } catch (_) {}

  function setTheme(theme) {
    const dark = theme === "dark";
    if (dark) root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme");
    themeButton.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    themeButton.title = dark ? "Switch to light theme" : "Switch to dark theme";
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute("content", dark ? "#171a1b" : "#e2e4dd");
  }

  setTheme(storedTheme === "dark" ? "dark" : "light");
  themeButton.addEventListener("click", function () {
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem("canon-theme", next); } catch (_) {}
  });

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

  const BOX_W = 186, BOX_H = 64, GAP_Y = 20;
  var colX = {};
  var spanX = depths.length > 1 ? (960 - BOX_W - 40) / (depths.length - 1) : 0;
  depths.forEach(function (d, i) { colX[d] = 20 + i * spanX; });

  var pos = {};
  depths.forEach(function (d) {
    var col = byDepth[d];
    var totalH = col.length * BOX_H + (col.length - 1) * GAP_Y;
    const top = (360 - totalH) / 2;
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
      // The edge TYPE is the argument — a copy is not a transformation. Say so on the line,
      // because a dash pattern does not survive video compression.
      const kind = u.type === "COPY" ? "COPY" : (u.type === "VIEW" ? "VIEW" : "TRANSFORMED");
      const lbl = el("text", {
        x: mid, y: (y1 + y2) / 2 - 5,
        class: "edge-label lbl-" + kind.toLowerCase(),
      });
      lbl.textContent = kind;
      svg.appendChild(lbl);
      edgeEls.push(lbl);
    });
  });

  // DataHub's siblings aspect: the dbt model is the definition, the warehouse table is the
  // thing you query. That is a lateral tie, not lineage, so it gets its own stroke.
  const sibSeen = {};
  D.evidence.forEach(function (e) {
    if (!e.siblingOf) return;
    const key = [e.urn, e.siblingOf].sort().join("|");
    if (sibSeen[key]) return;
    sibSeen[key] = true;
    const a = pos[e.urn], b = pos[e.siblingOf];
    if (!a || !b) return;
    const left = a.x <= b.x ? a : b, right = a.x <= b.x ? b : a;
    let d, lx, ly;
    if (Math.abs(a.x - b.x) < 1) {
      // Same column — bow out to the right rather than drawing a line through the boxes.
      const top = a.y <= b.y ? a : b, bot = a.y <= b.y ? b : a;
      const bx = left.x + BOX_W + 26;
      d = "M" + (top.x + BOX_W) + "," + (top.y + BOX_H / 2) +
          " C" + bx + "," + (top.y + BOX_H / 2) + " " + bx + "," + (bot.y + BOX_H / 2) +
          " " + (bot.x + BOX_W) + "," + (bot.y + BOX_H / 2);
      lx = bx - 2; ly = (top.y + bot.y) / 2 + BOX_H / 2;
    } else {
      // A sibling pair is usually also a lineage pair, so bow this curve clear of the
      // TRANSFORMED edge running between the same two boxes.
      const BOW = 22;
      const sx1 = left.x + BOX_W, sy1 = left.y + BOX_H / 2;
      const sx2 = right.x, sy2 = right.y + BOX_H / 2;
      const smid = (sx1 + sx2) / 2;
      d = "M" + sx1 + "," + sy1 + " C" + smid + "," + (sy1 + BOW) + " " + smid + "," + (sy2 + BOW) +
          " " + sx2 + "," + sy2;
      lx = smid; ly = (sy1 + sy2) / 2 + BOW + 7;
    }
    const sp = el("path", { d: d, class: "edge edge-sibling" });
    svg.appendChild(sp);
    edgeEls.push(sp);
    const sl = el("text", { x: lx, y: ly, class: "edge-label lbl-sibling" });
    sl.textContent = "SIBLING";
    svg.appendChild(sl);
    edgeEls.push(sl);
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

    // Assertion results, one pip each. This is the governance signal the ruling turns on,
    // and it reads as a contrast between candidates — canon never "fixes" an assertion.
    const pips = [];
    const asserts = e.assertions || [];
    asserts.slice(0, 8).forEach(function (a, i) {
      const cls = a.result === "SUCCESS" ? "pip-pass" : (a.result === "FAILURE" ? "pip-fail" : "");
      const c = el("circle", { class: "pip " + cls, cx: 13 + i * 10, cy: 48, r: 3.4 });
      g.appendChild(c);
      pips.push(c);
    });
    const meta = el("text", { class: "node-meta", x: 13 + Math.max(asserts.length, 1) * 10 + 4, y: 51 });
    meta.textContent = (asserts.length ? "" : "no assertions  ·  ") +
      e.owners + (e.owners === 1 ? " owner" : " owners") +
      (e.humanQueries != null ? "  ·  " + e.humanQueries + "q" : "");
    g.appendChild(meta);

    // Sits below the box so it can never collide with anything inside it.
    const badge = el("text", { class: "node-badge", x: 0, y: BOX_H + 11 });
    badge.textContent = "";
    g.appendChild(badge);

    const strike = el("line", { class: "node-strike", x1: 6, y1: BOX_H / 2, x2: BOX_W - 6, y2: BOX_H / 2 });
    g.appendChild(strike);

    svg.appendChild(g);
    nodeEls[e.urn] = { g: g, score: score, pips: pips, badge: badge, strike: strike };
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
          // Nothing will score this one, so show its assertions now rather than never.
          nodeEls[u].pips.forEach(function (c, k) {
            setTimeout(function () { c.classList.add("on"); }, 60 * i + 40 * k);
          });
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
        board.scrollTo({ top: Math.max(0, el.offsetTop - board.offsetTop - 8), behavior: "smooth" });
        setRail(s.urn, "ownership · deprecation · assertionRunEvent · operation");
        el.querySelector("[data-score]").textContent = (s.total > 0 ? "+" : "") + s.total;
        // The same number lands on the graph node, so the two views agree.
        var n = nodeEls[s.urn];
        if (n) {
          n.score.textContent = (s.total > 0 ? "+" : "") + s.total;
          if (s.total < 0) n.g.classList.add("neg");
          // The governance evidence lands on the node at the same instant as the score.
          n.pips.forEach(function (c, k) {
            setTimeout(function () { c.classList.add("on"); }, 40 * k);
          });
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
      const winner = D.ruling.canonical;
      const queryThis = D.ruling.queryThis;
      board.scrollTo({ top: 0, behavior: "smooth" });
      setRail(winner || "—", "siblings · structuredProperties (canon.*)");

      // The sibling is not a loser. Dimming it contradicted the ruling's own advice:
      // the dbt model is the DEFINITION, the warehouse table is the one you QUERY.
      Object.keys(cards).forEach(function (u) {
        if (u === winner || u === queryThis) cards[u].classList.add("win");
        else cards[u].classList.add("dim");
      });
      D.ruling.traps.forEach(function (t) {
        var el = cards[t.urn];
        if (el) el.querySelector(".trap-why").textContent = "[" + t.severity + "] " + t.why;
      });

      const scoredUrns = {};
      D.scores.forEach(function (s) { scoredUrns[s.urn] = true; });
      Object.keys(nodeEls).forEach(function (u) {
        if (!scoredUrns[u] && u !== winner && u !== queryThis) nodeEls[u].g.classList.add("dim");
      });

      // Worst first, so the picture visibly narrows toward the answer.
      const losers = D.scores
        .filter(function (s) { return s.urn !== winner && s.urn !== queryThis; })
        .map(function (s) { return s.urn; })
        .reverse();
      let standing = D.scores.length;
      const counter = chip("<b>" + standing + "</b> still standing", "good");
      losers.forEach(function (u, i) {
        setTimeout(function () {
          const n = nodeEls[u];
          if (n) { n.g.classList.add("dim"); n.strike.classList.add("on"); }
          standing -= 1;
          counter.innerHTML = "<b>" + standing + "</b> still standing";
        }, 180 * (i + 1));
      });
      setTimeout(function () {
        counter.innerHTML = "<b>" + D.scores.length + "</b> candidates → <b>1</b> ruling";
        const w = nodeEls[winner];
        if (w) {
          w.g.classList.add("win");
          w.badge.textContent = "DEFINITION";
          w.badge.classList.add("on");
        }
        const q = queryThis ? nodeEls[queryThis] : null;
        if (q) {
          q.g.classList.add("win-sib");
          q.badge.textContent = "QUERY THIS";
          q.badge.classList.add("on");
        }
      }, 180 * (losers.length + 1));
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

  // The falsification beat. Break the winner in a copy of the catalog, re-run the
  // same rule table, and watch the ruling move — in the page, not in a terminal.
  // This is "npm run poison", staged. If the ruling did NOT move, the evidence
  // would not be reaching the verdict, and the whole product would be theatre.
  if (D.whatIf) {
    const W = D.whatIf;

    // Puts the graph back into the shipped ruling, without animation.
    function settle() {
      Object.keys(nodeEls).forEach(function (u) {
        const n = nodeEls[u];
        n.g.classList.remove("win", "win-sib", "neg");
        n.badge.textContent = "";
        n.badge.classList.remove("on");
      });
      D.scores.forEach(function (s) {
        const n = nodeEls[s.urn];
        if (!n) return;
        n.score.textContent = (s.total > 0 ? "+" : "") + s.total;
        if (s.total < 0) n.g.classList.add("neg");
      });
      const w = nodeEls[D.ruling.canonical];
      if (w) {
        w.g.classList.remove("dim");
        w.g.classList.add("win");
        w.badge.textContent = "DEFINITION";
        w.badge.classList.add("on");
      }
      const q = D.ruling.queryThis ? nodeEls[D.ruling.queryThis] : null;
      if (q) {
        q.g.classList.remove("dim");
        q.g.classList.add("win-sib");
        q.badge.textContent = "QUERY THIS";
        q.badge.classList.add("on");
      }
    }

    function fillRules(card, hits) {
      const rules = card.querySelector(".rules");
      rules.innerHTML = "";
      hits.forEach(function (h, i) {
        const r = document.createElement("span");
        r.className = "rule " + (h.delta > 0 ? "pos" : "neg");
        r.textContent = (h.delta > 0 ? "+" : "") + h.delta + "  " + h.rule;
        r.title = h.because;
        rules.appendChild(r);
        setTimeout(function () { r.classList.add("on"); }, 40 * i);
      });
    }

    beats.push({
      label: "what-if · poison",
      run: function () {
        setRail(W.target, "deprecation · assertionRunEvent · ownership");
        const t = nodeEls[W.target];
        if (t) {
          t.pips.forEach(function (c) {
            if (!c.dataset.prev) c.dataset.prev = c.getAttribute("class");
            c.setAttribute("class", "pip pip-fail on");
          });
          t.g.classList.remove("win");
          t.g.classList.add("neg");
          t.badge.textContent = "DEPRECATED";
          t.badge.classList.add("on");
        }
        W.changes.forEach(function (c, i) {
          setTimeout(function () { chip(c, "bad"); }, 120 * i);
        });
      }
    });

    beats.push({
      label: "what-if · re-rule",
      run: function () {
        setRail(W.after.canonical || "—", "same rule table · poisoned graph");
        const t = nodeEls[W.target];
        if (t && W.after.total != null) t.score.textContent = String(W.after.total);
        // win-sib is styled after win, so it must go or the new winner keeps the
        // dashed sibling border instead of igniting.
        Object.keys(nodeEls).forEach(function (u) {
          nodeEls[u].g.classList.remove("win", "win-sib");
        });
        const nw = W.after.canonical ? nodeEls[W.after.canonical] : null;
        if (nw) {
          nw.g.classList.remove("dim");
          nw.g.classList.add("win");
          nw.badge.textContent = "CANONICAL NOW";
          nw.badge.classList.add("on");
        }
        const card = cards[W.target];
        if (card) {
          card.classList.remove("win");
          card.classList.add("neg");
          if (W.after.total != null) card.querySelector("[data-score]").textContent = String(W.after.total);
          fillRules(card, W.after.hits);
        }
        chip("ruling moved — <b>same code, same question</b>", "good");
      }
    });

    beats.push({
      label: "restore",
      run: function () {
        setRail(D.ruling.canonical || "—", "siblings · structuredProperties (canon.*)");
        const t = nodeEls[W.target];
        if (t) {
          t.pips.forEach(function (c) {
            if (c.dataset.prev) c.setAttribute("class", c.dataset.prev + " on");
          });
        }
        settle();
        const s = D.scores.filter(function (x) { return x.urn === W.target; })[0];
        const card = cards[W.target];
        if (card && s) {
          card.classList.remove("neg");
          card.querySelector("[data-score]").textContent = (s.total > 0 ? "+" : "") + s.total;
          fillRules(card, s.hits);
          if (s.total < 0) card.classList.add("neg");
          if (W.target === D.ruling.canonical) card.classList.add("win");
        }
        chip("catalog restored — <b>the shipped ruling stands</b>", "good");
      }
    });
  }

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
    board.scrollTop = 0;
    Object.keys(cards).forEach(function (u) {
      var el = cards[u];
      el.className = "cand";
      el.querySelector("[data-score]").textContent = "—";
      el.querySelector(".bar-fill").style.width = "0";
      el.querySelector(".rules").innerHTML = "";
      el.querySelector(".trap-why").textContent = "";
    });
    Object.keys(nodeEls).forEach(function (u) {
      const n = nodeEls[u];
      n.g.setAttribute("class", "node");
      n.score.textContent = "";
      n.score.removeAttribute("font-size");
      n.pips.forEach(function (c) {
        // The what-if beat rewrites pip classes; put the real ones back.
        if (c.dataset.prev) {
          c.setAttribute("class", c.dataset.prev);
          delete c.dataset.prev;
        }
        c.classList.remove("on");
      });
      n.badge.textContent = "";
      n.badge.classList.remove("on");
      n.strike.classList.remove("on");
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

  // Contested-subject posture across the whole catalog.
  var posturePanel = document.getElementById("panel-posture");
  if (!D.posture) {
    if (posturePanel) posturePanel.hidden = true;
  } else {
    var P = D.posture;
    var cells = [
      { n: P.contested, k: "contested subjects", sub: "concepts more than one asset answers to", cls: "" },
      { n: P.ruled, k: "ruled", sub: "the catalog carried enough to decide", cls: "p-win" },
      { n: P.referredToOwners, k: "referred to owners", sub: "two definitions share a word", cls: "p-warn" },
      { n: P.needsMoreEvidence, k: "needs more evidence", sub: "canon declines to guess", cls: "p-info" }
    ];
    document.getElementById("posture").innerHTML = cells.map(function (c) {
      return '<div class="p-cell ' + c.cls + '"><span class="p-n">' + c.n + "</span>" +
        '<span class="p-k">' + c.k + "</span>" +
        '<span class="p-sub">' + c.sub + "</span></div>";
    }).join("");

    var bl = document.getElementById("backlog");
    P.backlog.slice(0, 5).forEach(function (b) {
      var li = document.createElement("li");
      li.innerHTML = '<span class="bl-n">' + b.blocks + "</span>" +
        '<span class="bl-need">subjects blocked on ' + b.need + "</span>";
      bl.appendChild(li);
    });

    var cost = document.createElement("p");
    cost.className = "lede p-cost";
    cost.innerHTML =
      "All " + P.contested + " subjects cost <strong>" + P.totals.modelCalls +
      " model calls</strong>, " + P.totals.graphReads + " graph reads and " + P.totals.ms +
      "ms — about " + (P.totals.graphReads / P.contested).toFixed(1) +
      " reads per subject. The decision layer is a rule table, so re-running the whole catalog " +
      "nightly costs graph reads and nothing else.";
    posturePanel.appendChild(cost);
  }

  // Downstream retrieval, before and after the write-back.
  var dsRoot = document.getElementById("downstream");
  var dsPanel = document.getElementById("panel-downstream");
  if (!D.downstream || !D.downstream.length) {
    if (dsPanel) dsPanel.hidden = true;
  } else {
    D.downstream.forEach(function (q) {
      var block = document.createElement("div");
      block.className = "ds-block";
      var head =
        '<div class="ds-q">' + q.question + "</div>" +
        '<div class="ds-gt">correct answer: ' + q.groundTruth + "</div>";
      var rowsHtml = q.strategies.map(function (s) {
        function rank(n) { return n === null ? "not served" : "#" + n; }
        var correctCell, trapCell, verdict;
        if (!q.hasAnswer) {
          var same = s.correctBefore === s.correctAfter && s.offeredBefore === s.offeredAfter;
          correctCell = '<span class="ds-flat">no right answer to rank</span>';
          trapCell = '<span class="ds-flat">—</span>';
          verdict = same
            ? '<span class="ds-ok">ordering identical</span>'
            : '<span class="ds-bad">ordering moved</span>';
        } else {
          correctCell = rank(s.correctBefore) + ' <span class="ds-ar">→</span> ' + rank(s.correctAfter);
          var gone = s.trapBefore !== null && s.trapAfter === null;
          trapCell =
            '<span class="' + (s.trapBefore === null ? "ds-ok" : "ds-bad") + '">' + rank(s.trapBefore) + "</span>" +
            ' <span class="ds-ar">→</span> ' +
            '<span class="' + (s.trapAfter === null ? "ds-ok" : "ds-bad") + '">' + rank(s.trapAfter) + "</span>";
          verdict = gone
            ? '<span class="ds-ok">impostor suppressed</span>'
            : '<span class="ds-flat">unchanged</span>';
        }
        return (
          '<tr><td class="ds-name">' + s.id + '<div class="ds-desc">' + s.describes + "</div></td>" +
          '<td class="ds-cell">' + correctCell + "</td>" +
          '<td class="ds-cell">' + trapCell + "</td>" +
          '<td class="ds-verdict">' + verdict + "</td></tr>"
        );
      }).join("");
      block.innerHTML =
        head +
        '<table class="ds-table"><thead><tr>' +
        "<th>strategy</th><th>the right table</th><th>" +
        (q.trapLabel ? "the impostor (" + q.trapLabel + ")" : "the impostor") +
        "</th><th></th></tr></thead><tbody>" + rowsHtml + "</tbody></table>";
      dsRoot.appendChild(block);
    });
  }

  // The plan, then the fulcrum click, then what landed.
  var planList = document.getElementById("plan");
  D.plan.forEach(function (s) {
    var li = document.createElement("li");
    li.textContent = s;
    // The deprecation is the consequential one — other people and agents act on
    // it — so it is marked rather than hidden in a list of equals.
    if (/^Deprecate /.test(s)) li.className = "consequential";
    planList.appendChild(li);
  });

  var rl = document.getElementById("receipts");
  D.receipts.forEach(function (r) {
    var li = document.createElement("li");
    li.innerHTML = '<span class="r-ok">' + (r.applied ? "✓" : "✗") + "</span>" +
      '<span class="r-sum">' + r.summary + "</span>" +
      '<span class="r-via" style="margin-left:auto">' + r.via + "</span>";
    rl.appendChild(li);
  });

  document.getElementById("approve").addEventListener("click", function apply() {
    var row = document.getElementById("approve-row");
    if (row.classList.contains("done")) return;
    row.classList.add("done");
    document.getElementById("approve").textContent = "Approved";
    document.querySelector(".approve-note").textContent =
      D.mode === "live"
        ? "Applied to the DataHub instance this page was rendered from."
        : "Applied to the fixture graph this page was rendered from.";
    document.getElementById("applied").hidden = false;

    var items = rl.querySelectorAll("li");
    items.forEach(function (li, i) { setTimeout(function () { li.classList.add("on"); }, 90 * i); });

    setTimeout(function () {
      document.getElementById("verify").textContent = D.verification || "";
      document.getElementById("ask-twice").textContent =
        "Ask the same question again and the catalog answers it: " + D.second.answeredBy +
        ", " + D.second.reads + " graph read" + (D.second.reads === 1 ? "" : "s") +
        ", no adjudication at all.";
    }, 90 * items.length + 200);
  });

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
