# Playwright E2E — canon evidence report

Driven through the Playwright MCP server against `out/index.html`, served over
`http://127.0.0.1:8770` (the `file:` protocol is blocked by the browser harness).

Run: 2026-08-05, overnight build session. Viewport 1440×900, Chromium.

## Flows exercised

| # | Flow | Result |
|---|---|---|
| 1 | Page loads, no JS errors | **PASS** — only a `favicon.ico` 404 |
| 2 | Cold open renders both numbers and the delta | **PASS** |
| 3 | `Play` drives all beats to completion | **PASS** — `beat-label` reaches `done` |
| 4 | Mute-proof chips appear | **PASS** — 7 chips, each carrying a changed number |
| 5 | Candidate scores render from the rule table | **PASS** — +149 / +75 / −41 / −75 / −132 |
| 6 | Winner ignites, impostors dim | **PASS** — `.cand.win` on the winner, `.cand.dim` on the rest |
| 7 | Traps carry severity and consequence | **PASS** — one `[blocker]`, three `[warning]` |
| 8 | Verdict panel reveals with mechanism | **PASS** — `RESOLVED`, `DUPLICATES` |
| 9 | Diegetic rail tracks URN + aspect | **PASS** — ends on the winner URN + the three write surfaces |
| 10 | Baselines table shows three different wrong picks | **PASS** |
| 11 | Write-back receipts name real transports | **PASS** — see the defect found below |
| 12 | ABSTAIN section renders both definitions + mechanism | **PASS** — `COMPETING_DEFINITIONS`, GROSS vs NET |
| 13 | `Reset` returns the stage to its initial state | **PASS** |

## Defects this run found and fixed

Both were found by asserting on the DOM, not by reading the code — which is the
point of running it.

### 1. The fixture path still emitted fake `mcp:*` transport labels

`#receipts` rendered `mcp:set_structured_property`, `mcp:upsert_document` and
`mcp:update_deprecation`. This is the exact finding the pre-submission audit
raised: no MCP call carried those writes, and `mcp:update_deprecation` names a
tool that does not exist in DataHub OSS at all. The live client had been fixed
earlier in the session; the **mock had not**, and the mock is what a judge runs
with no credentials.

Fixed in `src/datahub/mock.ts` — receipts now read
`fixture:structuredProperty (live -> mcp:add_structured_properties)`, which says
what happened and what would happen live, without claiming either falsely.

### 2. The `canon.*` property names disagreed across the codebase

`#receipts` showed `canon.supersededBy` and `canon.decidedAt` while the live
client read `canon.superseded_by` and `canon.decided_at`, and
`bridge/ingest_catalog.py` defined the snake_case pair. Consequence: against a
live instance the write-back set values on properties DataHub had never been
told about, and the read-back returned zero superseded assets — indistinguishable
from "nothing was superseded".

Fixed by consolidating into `src/datahub/properties.ts` as the single source of
truth, plus two tests that keep it that way:

- `CONTRACT: the Python ingest defines exactly the canon.* properties the writer uses`
- `CONTRACT: no source file declares a canon.* property name of its own`

## Screenshots

| File | What it shows |
|---|---|
| `examples/screenshots/canon-01-hero.png` | Cold open: two dashboards disagree — $7,951,811.55 struck through → $7,121,844.95, the $829,966.60 delta |
| `examples/screenshots/canon-02-adjudication.png` | Scored candidates with every rule that fired, winner ignited, rail naming the URN and aspects |
| `examples/screenshots/canon-03-abstain.png` | The refusal: two definitions, their columns, and the `COMPETING_DEFINITIONS` verdict |

## Reproducing

```bash
npm run demo                       # writes out/index.html
cd out && python3 -m http.server 8770 --bind 127.0.0.1
# then drive http://127.0.0.1:8770/index.html
```

---

## Second pass — the lineage neighbourhood

Added after the first pass: an inline SVG lineage graph that assembles as
evidence lands, so the graph depth is on screen rather than described.

| # | Flow | Result |
|---|---|---|
| 14 | Nodes lay out by derivation depth read off `upstreamLineage` | **PASS** — 4 columns: source, landing, modelled, materialised |
| 15 | Edges render with their real type | **PASS** — 4 edges, 1 `COPY` (dashed amber), 3 `TRANSFORMED` (solid) |
| 16 | Scores land on the graph nodes and match the cards | **PASS** — −41 / −75 / +149 / +75 / −132 |
| 17 | Winner ignites on the graph, losers dim | **PASS** — `.node.win` on `fct_orders` only |
| 18 | A candidate with no readable schema is labelled, not blank | **PASS** — `orders_explore` reads "no schema" |
| 19 | `Reset` clears the graph too | **PASS** |

Screenshot: `examples/screenshots/canon-04-lineage.png`. The whole argument is legible in that one
frame with the sound off: the raw table on the left, a dashed COPY edge to the
stale landing copy, a TRANSFORMED edge to the canonical model in green, and the
warehouse sibling beside it.

---

## Third pass — the fulcrum click

Added after re-reading the two craft sources the build brief required. Both
converged on the same gap: the ClickHouse carry-forward rule *"ship an
interactive answer, not a rendered one — and the payoff card is the most
interactive, never the least"*, and the Globot transplant *"one human fulcrum
click"*. canon's payoff — the write-back — was the least interactive thing on
the page: a static list of receipts that had already happened.

Now the panel shows the **plan**, with the one consequential line (the
deprecation) marked rather than buried among equals, and a single button applies
it.

| # | Flow | Result |
|---|---|---|
| 20 | Plan renders before anything is applied | **PASS** — 5 planned writes, receipts hidden |
| 21 | The consequential write is marked | **PASS** — only the deprecation gets `.consequential` |
| 22 | One click applies | **PASS** — 9 receipts cascade in |
| 23 | Verification and the second-ask line follow | **PASS** |
| 24 | The button states what it did, honestly | **PASS** — "Applied to the fixture graph this page was rendered from" |

Screenshot: `examples/screenshots/canon-05-fulcrum.png`.

---

## Fourth pass — the downstream measurement

Added with `src/eval/downstream.ts`. The panel reports what canon's write-back
did to a stock retrieval client, measured rather than asserted.

| # | Flow | Result |
|---|---|---|
| 25 | Panel renders and is not hidden | **PASS** — 2 question blocks |
| 26 | Ground truth is stated per question | **PASS** — the price_delta pair; "none" for the control |
| 27 | The impostor column names the actual URN | **PASS** — `snowflake:ANALYTICS.STAGING.STG_ORDERS` |
| 28 | A metadata-blind client is unchanged | **PASS** — top-hit: right table `#7 → #7`, impostor `#5 → #5` |
| 29 | A governance-aware client stops serving the impostor | **PASS** — `#11 → not served`, both governance strategies |
| 30 | The negative result is shown, not hidden | **PASS** — right table reads `#1 → #1`; the panel says so in prose |
| 31 | The abstain control does not move | **PASS** — all three strategies "ordering identical" |
| 32 | Adding the panel did not break the fulcrum click | **PASS** — 9 receipts, verification still reproduces the ruling |
| 33 | The fixed rail does not obscure the new panel | **PASS** — `body` padding-bottom 64px clears the 35px rail |

Screenshot: `examples/screenshots/canon-06-downstream.png` (`.playwright-mcp/` is
gitignored, so the run output is copied where a judge can actually open it).

---

## Fifth pass — the governance tier rule

`tag.certified` generalised into `governance.tier`, which reads the trust ladder
the catalog already declared. The point of driving this through the browser is
that the rule table is rendered into the report, so a rule rename that silently
changed a published score would show up here.

| # | Flow | Result |
|---|---|---|
| 34 | Every published score is unchanged | **PASS** — 149 / 75 / −41 / −75 / −132, byte-identical |
| 35 | The tier rule fires and carries the tier vocabulary | **PASS** — `+16 governance.tier`, "tagged Certified — the organisation's top trust tier" |
| 36 | The old rule id is gone, not living alongside the new one | **PASS** — no `tag.certified` hit on any candidate; two rules reading one tag would double-count it |
| 37 | The rationale names the tier in prose | **PASS** — the RESOLVED panel reads "tagged Certified — the organisation's top trust tier — reviewed, owned and documented" |
| 38 | The falsification demo still moves the ruling | **PASS** — `npm run poison`, old winner still lands on −89 |

Screenshot regenerated: `examples/screenshots/canon-02-adjudication.png` — the
old one showed `+16 tag.certified` and is embedded at the top of the README, so
leaving it would have published a rule name the code no longer has.

The lower rungs of the ladder are not exercised by the demo catalog, which uses
`Certified` and nothing else. They are covered in `tests/tier.test.ts` against
synthetic catalogs, along with the guarantee that matters most here: **canon
never plans a mutation that writes a tier.**

---

## Sixth pass — the contested-subject posture

The scale answer: every concept in the catalog that more than one asset answers
to, put through the same adjudicator.

| # | Flow | Result |
|---|---|---|
| 39 | Panel renders with the four counts | **PASS** — 55 contested, 14 ruled, 1 referred, 40 needing evidence |
| 40 | The buckets are exhaustive | **PASS** — 14 + 1 + 40 = 55, asserted in the DOM, not just in the summariser |
| 41 | The backlog is rendered in priority order | **PASS** — 41 owner, 40 tier, 40 assertions |
| 42 | The cost line reports real totals | **PASS** — "0 model calls, 905 graph reads and 50ms — about 16.5 reads per subject" |
| 43 | The report agrees with the standalone sweep | **PASS** — `npm run coverage` gives the same 55 / 14 / 1 / 40 |

Screenshot: `examples/screenshots/canon-07-posture.png`.

### One defect this pass found

The posture initially ran *after* the hero write-back had been applied, so the
report was describing a catalog canon had already modified — with
`STG_ORDERS` freshly deprecated — while `npm run coverage` described the catalog
as it ships. The two agreed on this run by luck: the extra deprecation made the
`order` subject resolve harder, and it was already resolving.

Fixed by hoisting the sweep in `scripts/demo.ts` to before the first
`resolve()`, next to the downstream baseline, which has the same requirement for
the same reason. Both numbers now come from the shipped catalog and cannot drift
apart.

---

## Seventh pass — full regression

Run after the last change, over the regenerated page, driving the whole flow
end to end rather than one panel.

| # | Flow | Result |
|---|---|---|
| 44 | Page loads with zero console errors | **PASS** — 0 errors, 0 warnings, served over http |
| 45 | All six panels present and visible | **PASS** — baselines, pricing, write-back, posture, downstream, abstain |
| 46 | `Play` still drives every beat to completion | **PASS** — `beat-label` reaches `done` |
| 47 | Every published score is intact after six phases of change | **PASS** — 149 / 75 / −41 / −75 / −132 |
| 48 | The posture counts are intact | **PASS** — 55 / 14 / 1 / 40 |
| 49 | Approve still applies and verifies | **PASS** — 9 receipts, read-back reproduced the ruling |

`examples/report.html` regenerated from this run, so the committed copy a judge
opens without running anything carries all of it.

## Commands a judge can run to check any of this

```bash
npm test              # 47
npm run eval:ci       # pick 12/12, abstain 11/12
npm run downstream:ci # the retrieval delta, negative result included
npm run coverage:ci   # 55 contested, 14 / 1 / 40
npm run poison        # the ruling moves, or the script exits non-zero
```

### What flow 30 is doing there

The first honest run of this measurement contradicted the hypothesis it was
built to confirm. The expectation was that the write-back would move the correct
table up the ranking. It did not — a governance-aware client already ranked it
first, because the fixture gives `fct_orders` a curated description, an owner and
a `Certified` tag, and that was enough.

The measurement was changed to also track where the *impostor* ranks, which is
where the effect actually is, and the panel now states the negative result in
prose rather than reporting "no change" and moving on. Flow 30 asserts the
negative result is still on the page, so it cannot quietly disappear later.
