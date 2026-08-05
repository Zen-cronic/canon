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
| `examples/screenshots/canon-01-hero.png` | Cold open: Friday 4:55 PM, $7,951,811.55 struck through → $7,121,844.95, the $829,966.60 delta |
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
