# Judging map

Every criterion, mapped to the file, the command, and the output that backs it.
Nothing here asks you to take a sentence on trust — each row is something you can
run in under a minute, and the committed outputs are in `examples/` if you would
rather not.

Environment for everything marked *live*: DataHub OSS v1.7.0 via
`datahub docker quickstart`, `mcp-server-datahub` 3.4.5. Everything else runs
with no credentials at all.

---

## 1. Use of DataHub

> *How meaningfully does the project use DataHub — its context graph (lineage,
> ownership, schemas, ML metadata, governance signals), the MCP Server, Agent
> Context Kit, DataHub Skills, or Analytics Agent? The strongest submissions go
> beyond reading metadata and contribute back to the graph where appropriate.*

**The graph is the evidence, not the input.** Every one of canon's 22 rules
reads a named DataHub aspect and returns a signed number. Remove DataHub and
there is nothing to adjudicate.

| Aspect read | Rule it feeds | Why it matters |
|---|---|---|
| `upstreamLineage.type` | `lineage.modelled`, `lineage.landing_copy` | `COPY` vs `TRANSFORMED` is the difference between a landing copy and a modelled table |
| `operation.lastUpdatedTimestamp` | `freshness.current` / `freshness.stale` | the three-day gap that made the board number wrong |
| `assertionRunEvent` | `assertions.passing` / `failing` / `untested` | +14 each, against a +6 cap on popularity |
| `ownership` | `ownership.technical` / `business` / `none` | an unowned table four people query is an incident |
| `deprecation` | `deprecation.marked` | −70; someone already said this is not it |
| `globalTags` | `tag.certified`, `tag.deprecated` | the organisation's own signal |
| `glossaryTerms`, `schemaMetadata.glossaryTerms` | `governance.pii_exposed`, `glossary.classified` | governance outranks convenience |
| `siblings` | `siblings.definition` | the dbt model is the definition, the warehouse table is what you query |
| `datasetUsageStatistics` | `usage.human_adoption`, `usage.machines_only` | deliberately weak, and that is the argument |
| `datasetProfile` | trap consequences | "22,226 rows short of the winner" |

| Check | Command | Expect |
|---|---|---|
| The rule table, as data | `npm run rules` | 22 rules, each with the aspect it reads |
| Reads and writes over MCP *(live)* | `npm run mcp:probe` | 20 tools; the 8 Cloud-only ones confirmed **absent** — [`examples/mcp-tools.txt`](examples/mcp-tools.txt) |
| Write-back lands | `node scripts/resolve.ts --subject "customer orders" --question "..." --force --approve` *(live)* | `add_structured_properties`, `save_document`, deprecation via the SDK |
| The graph answers next time | re-run without `--force` *(live)* | `answered by: graph` |
| Another agent benefits | `npm run ask-once` *(live)* | a stock MCP client, none of canon's code, finds the canonical table — [`examples/ask-once.txt`](examples/ask-once.txt) |

**On scoping.** canon deprecates exactly one asset, and the test is narrow
([`isTrulyDead`](src/agent/score.ts)). The operational source scores −41 and is
still only a warning, because deprecating the table the checkout service writes
to would be false metadata. Losers get a question-scoped `canon.superseded_by`,
never a global claim. `npm test` pins this:
`SCOPED DEPRECATION: the operational source is never deprecated, however badly it scores`.

**OSS-only.** `set_deprecation`, the proposal tools and the lifecycle tools are
DataHub Cloud. canon claims none of them, and `npm run mcp:probe` prints their
absence rather than the README asserting it.

## 2. Technical Execution

> *Quality of implementation, robustness, and whether the project actually works
> end-to-end. Does the code do what the submission claims?*

| Check | Command | Expect |
|---|---|---|
| Tests | `npm test` | 23 passing |
| Types | `npm run typecheck` | clean |
| Zero-credential demo | `npm run demo` | full run + `out/index.html` in ~35s |
| CI | [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | typecheck, tests, the eval gate, and the demo, on every push |
| End-to-end against real DataHub | [RUNNING-LIVE.md](RUNNING-LIVE.md) | 1905/1905 aspects ingested; ruling; write-back; graph-answered re-ask |

**The decision path is deterministic.** No model call on any path, with or
without a key ([`src/agent/rules.ts`](src/agent/rules.ts)). That is what lets
`npm run poison` change the answer identically in every take, and what lets the
eval score the adjudicator at all.

**Two upstream problems were hit and worked around, not papered over**
([`docs/UPSTREAM-NOTES.md`](docs/UPSTREAM-NOTES.md)): the MCP server leaks pooled
connections and hangs permanently after ~6 URNs per process, and its
`get_entities` returns a subset of aspects that excludes four of the five things
canon's rules need. Both have reproducers with timings.

**Two defects were found by driving the UI with Playwright and fixed**
([`.playwright-mcp/E2E-RESULTS.md`](.playwright-mcp/E2E-RESULTS.md)): the fixture
path still emitted fake `mcp:*` transport labels, and the `canon.*` property
names disagreed between the writer and the reader. Both are now pinned by tests.

## 3. Originality

> *Submissions should clearly go beyond features DataHub already provides out of
> the box.*

DataHub ships deprecation, structured properties, siblings and Documents. canon
**composes** those primitives; it does not reimplement them. What is not in the
box is the judgement:

- **The duplicate-vs-different-definition test.** Same grain + compatible
  measure semantics → one of them is canonical, so rule. Same grain + disjoint
  measure semantics (`gross_bookings_usd` vs `recognised_revenue_usd`) → two
  live definitions, so refuse. ([`src/agent/cohort.ts`](src/agent/cohort.ts))
- **ABSTAIN as a first-class, evidenced outcome** that files a native Incident
  to named owners rather than inventing a winner.
- **A weighted, published, falsifiable rule table** rather than a prompt. The
  weights are exported as data and rendered in the report.
- **Deprecation with a defensible scope test**, rather than deprecating
  everything that lost.

`npm run poison` is the originality claim in executable form: if the ruling
were a prompt or a fixture, poisoning the catalog would change nothing. It moves
149 → −89.

## 4. Real-World Usefulness

> *Would a real data, ML, or AI platform team see clear value in this?*

The failure canon addresses is the one every practitioner has personally lost
hours to: several tables answer to the same name, and the popular one is stale.
On the demo catalog the most-queried-by-humans table — 419 queries from four
analysts — is a `COPY` that is three days behind with a failing freshness
assertion and no owner. That is not a contrived fixture; it is the shape of the
problem.

| Check | Command | Expect |
|---|---|---|
| The error, in money | `npm run price` | $7,951,811.55 vs $7,121,844.95 — $829,966.60, from two `SELECT`s against DuckDB |
| Why | same | 3 missing days, 518 test orders, $334,160.03 of refunds never netted |
| It refuses when it should | `npm run demo` | the ABSTAIN branch on "daily revenue" |

The dollar figure is computed, not asserted: `bridge/price_delta.py` builds the
warehouse from a fixed seed, materialises the staging copy and the modelled table
the way the catalog says they are built, and runs the same board query against
both.

## 5. Submission Quality

> *Quality of the demo video, written description, and README. A judge should be
> able to understand what the project does, why it matters, and find clear setup
> instructions to try it themselves.*

| Artifact | Where |
|---|---|
| README leading with the question and the ruling | [README.md](README.md) |
| Self-contained visual report, no server | `npm run demo` → `out/index.html`, committed at [`examples/report.html`](examples/report.html) |
| Sample outputs | [`examples/`](examples/) — eval JSON, MCP tool list, ask-once, poison, screenshots |
| Live setup, step by step | [RUNNING-LIVE.md](RUNNING-LIVE.md) |
| Eval with its miss published | [`eval/README.md`](eval/README.md) |
| Upstream problems, with reproducers | [`docs/UPSTREAM-NOTES.md`](docs/UPSTREAM-NOTES.md) |
| E2E results | [`.playwright-mcp/E2E-RESULTS.md`](.playwright-mcp/E2E-RESULTS.md) |
| Honest limits | [README.md](README.md#honest-limits) |

The report is built to be read with the sound off: every beat leaves a changed
number on screen, and a fixed rail names the URN and aspect in play.

**Demo video: not yet recorded.** Scheduled for daylight before the deadline.

---

## Claims that would be fair to check first

If you have five minutes and want to find a hole, these are the load-bearing
ones and how to test them:

1. **"No model decides the ruling."** `grep -rn "askJson" src/` — two callers,
   `triage.ts` (may only narrow an already-computed shortlist, and every URN is
   validated against the search results) and `narrate.ts` (given the decision,
   returns prose). Neither can change a winner. Or just run `npm run demo` with
   no API key and note that a ruling still appears, computed.
2. **"Poisoning the catalog changes the answer."** `npm run poison`. Exits
   non-zero if it does not.
3. **"The eval is not stacked."** `grep -n "^import" src/eval/scenarios.ts` —
   one `import type` of the shared aspect shapes, nothing else. Then
   `npm run eval -- --seed 99 --n 40` and see whether the numbers hold on a draw
   nobody tuned.
4. **"Only one asset is deprecated."** `npm run demo` and count `[blocker]` in
   the traps, or read the `SCOPED DEPRECATION` tests.
5. **"It only uses OSS surfaces."** Run:

   ```bash
   grep -rn "set_deprecation\|propose_\|list_pending\|lifecycle\|find_sql_context\|draft_sql_for_tables" src/ scripts/ bridge/
   ```

   Four hits, none of them a call:

   - `src/datahub/live.ts:19` and `:371` — comments saying `set_deprecation` is
     Cloud only, which is why that write goes through the SDK;
   - `scripts/mcp-probe.ts` — the list of names it checks are **absent**;
   - `bridge/emit_aspects.py` — a docstring and a `why_not_mcp` field, same
     reason.

   Then run `npm run mcp:probe` against a quickstart and read the absence off a
   live server rather than off this file.
6. **"The dollar figure is real."** `npm run price` and read the two queries it
   prints.
