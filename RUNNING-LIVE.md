# Running canon against a live DataHub

`npm run demo` needs none of this — it runs end to end on the committed fixture
catalog with no credentials. This file is for running the same code against a
real DataHub OSS instance, which is how every live number in the README was
produced.

Everything here was executed on 2026-08-05 against DataHub OSS v1.7.0 and
`mcp-server-datahub` 3.4.5. Where something needed a workaround, it is named.

---

## 1. Start DataHub OSS

Needs Docker, 2 CPU and 8 GB of RAM.

```bash
pip install acryl-datahub          # or: uv tool install acryl-datahub
export DATAHUB_TELEMETRY_ENABLED=false
export DATAHUB_MAPPED_GMS_PORT=8081   # only if something already holds 8080
datahub docker quickstart
```

The UI comes up on <http://localhost:9002> (`datahub` / `datahub`) and GMS on
`http://localhost:8081`. The quickstart ships with metadata-service auth
disabled, so **no token is needed locally**. For anything hardened, mint a PAT
in the UI under Settings → Access Tokens and set `DATAHUB_GMS_TOKEN`.

Check it is up:

```bash
curl -s http://localhost:8081/config | head -c 200
```

## 2. Load the demo catalog

The same 257 entities the offline demo uses, emitted as real DataHub aspects —
`datasetProperties`, `editableDatasetProperties`, `schemaMetadata`, `ownership`,
`globalTags`, `glossaryTerms`, `deprecation`, `upstreamLineage` (with edge
types), `siblings`, `datasetProfile`, `datasetUsageStatistics`, `operation`,
`assertionInfo` and `assertionRunEvent` — plus the five `canon.*` structured
property definitions.

```bash
python bridge/ingest_catalog.py --gms http://localhost:8081
# entities:  257
# aspects:   1905 metadata change proposals
# done:      1905/1905 aspects emitted in 65s
```

Give the search and graph indices a minute to catch up before the next step;
DataHub ingests through Kafka and the index lags the write.

**The clock is rebased to now by default, and it matters.** The fixture catalog's
timestamps are frozen at the moment it was authored. Offline that is fine — the
mock client answers "what time is it" with the catalog's own clock. A live
DataHub has no such notion, so an unrebased catalog ages: a day after ingestion
everything is a day staler, and once every candidate crosses the staleness
threshold no definition class is "standing" any more and the ABSTAIN branch stops
firing — silently, with no error. Ingest shifts every timestamp by one offset, so
every relative gap survives: the staging copy stays exactly 3.1 days behind the
mart whenever you run this. Pass `--no-rebase-clock` to emit the frozen values
instead.

## 3. Confirm which MCP tools you actually have

Worth doing before trusting any tool list, including this project's:

```bash
export DATAHUB_GMS_URL=http://localhost:8081
export DATAHUB_TELEMETRY_ENABLED=false
export TOOLS_IS_MUTATION_ENABLED=true
npm run mcp:probe
```

On OSS v1.7.0 this prints 18–20 tools and confirms that `set_deprecation`,
`list_pending_proposals`, `propose_*`, `accept_or_reject_proposals`,
`list_lifecycle_stages`, `find_sql_context` and `draft_sql_for_tables` are all
**absent** — they are DataHub Cloud only. canon claims none of them. A committed
copy of that output is in [`examples/mcp-tools.txt`](examples/mcp-tools.txt).

The count varies because the tool list is not static: a freshly-ingested instance
reported 18, and the same server reported 20 once canon had written a Document —
the extras were `search_documents` and `grep_documents`. Reported as an
observation; the mechanism was not confirmed.

## 4. Run canon live

```bash
export CANON_MODE=live
export DATAHUB_GMS_URL=http://localhost:8081
export DATAHUB_TELEMETRY_ENABLED=false
export TOOLS_IS_MUTATION_ENABLED=true

# read-only: rule on the question, print the plan, write nothing
node scripts/resolve.ts --subject "customer orders" \
  --question "Which table should I use for customer orders?" --force

# apply the plan
node scripts/resolve.ts --subject "customer orders" \
  --question "Which table should I use for customer orders?" --force --approve

# ask again — the catalog answers, no adjudication
node scripts/resolve.ts --subject "customer orders" --question "..."

# what any other agent now sees, using none of canon's code
npm run ask-once
```

Add `CANON_MCP_DEBUG=1` to see every MCP call and its duration.

## 5. Look at it in DataHub

- The winner, `dbt:analytics.marts.fct_orders` — Properties tab shows
  `canon.status = canonical`, `canon.subject = customer orders`,
  `canon.rationale` and `canon.decided_at`.
- `snowflake:ANALYTICS.STAGING.STG_ORDERS` — deprecated, note pointing at the
  winner.
- The other losers — `canon.superseded_by` pointing at the winner, and **no**
  deprecation, because they are not dead, they are just not the answer to this
  question.
- Search for the ruling Document: canon writes the evidence trail as a native
  DataHub Document of type `Decision`, related to every candidate.

---

## What is different in live mode

Named here rather than smoothed over. Full detail in
[`docs/UPSTREAM-NOTES.md`](docs/UPSTREAM-NOTES.md).

| | Fixture mode | Live mode |
|---|---|---|
| Assertions | per-assertion results (freshness / volume / column) | DataHub's aggregate `health` verdict — OSS MCP exposes no per-assertion read, so live mode sees one synthetic assertion carrying PASS or FAIL |
| Search score | a relevance score | rank position; the MCP search response carries no score, and the report says rank |
| Second ask | 1 graph read | 2 MCP calls — `search`, then `get_entities` to read the properties off the hits |
| Hero score | 149 vs 75 | 102 vs 52 — same winner, same order, smaller numbers because one aggregate assertion is worth less than three individual ones |

The ruling, the ordering, the sibling redirect and which single asset is
deprecable are identical on both paths. The rule table does not know which
client it is talking to.

## Resetting

```bash
datahub docker nuke        # destroys the quickstart entirely
datahub docker quickstart  # start over, then re-run step 2
```
