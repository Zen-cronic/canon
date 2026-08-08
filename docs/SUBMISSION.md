# Devpost submission — canon

Copy for the eight fields on the "Enter a Submission" form. Kept in the repo so
the submitted text and the shipped code stay in one place.

---

## 1. Elevator pitch

> Duplicate-versus-definition adjudication. 22 weighted rules, no model in the
> decision. canon rules which of five `orders` tables is the real one — and
> retires the other four.

## 3. Challenge category

**Agents That Do Real Work**

## 2. About the project

### Inspiration

Two dashboards, two revenue numbers, and the board deck goes out in the morning.
Which one can I send?

The honest answer in most companies is: ask around. Five tables answer to
`orders` — a landing copy, a modelled mart, a warehouse sibling, a frozen
snapshot, a staging table nobody deleted — and the catalog cheerfully returns
all five. It records which exist. It does not say which one you are supposed to
cite.

This is not a small-catalog problem. DataHub's own published customer story for
a 400,000-table estate, growing by 500 tables a day, describes analysts
*"reverse-engineering trust, going through code, tracing lineage, and dropping
Slack messages hoping someone would respond"* — and a governance program that
narrowed those 400,000 tables to 100,000 governed, AI-ready assets. Ranking on
relevance alone surfaces the deprecated staging table above the production one,
because relevance and trustworthiness are not the same signal.

The difference between our two figures was **$829,966.60**, 11.65%
overstated, and it came from a staging copy that is three days behind, includes
518 internal test orders, and never nets off $334,160.03 of refunds. An agent
asking that catalog which table to use would have picked the wrong one too —
querying a stale table is the first way a context layer fails, and it fails
quietly.

A catalog that cannot answer that question is a search index with governance
metadata attached. canon is the part that rules — it decides which table the
next query, and the next agent, gets handed.

### What it does

canon reads a DataHub catalog and decides which asset is canonical for a given
subject, then writes the ruling back into the graph so nobody has to ask again.

The mechanism runs in two stages, and the first one is the whole product.

**Duplicates versus different definitions.** Two assets that both answer to
"revenue" are one of two things. *Duplicates* are the same business fact
materialised more than once — they share a grain and compatible measure
semantics, so exactly one should be cited and a catalog can pick a winner.
*Different definitions* are genuinely different facts that share a word:
Finance's recognised revenue net of refunds and Growth's gross bookings
including shipping have the same grain and the same ancestor, but declare
different measure semantics. Both are correct, and no amount of lineage,
freshness or ownership metadata can choose between them, because the
disagreement is organisational rather than technical.

Ruling on that pair would launder a disagreement into a fact, which is the worst
failure available to this product — so the partition gates the scorer rather
than the reverse. When canon cannot settle it, it **abstains** and files the
question inside DataHub to the owners who can.

**The ruling itself** comes from 22 named, signed, weighted rules over real
DataHub aspects: `upstreamLineage` and its edge types, `siblings`, `operation`
for freshness, `ownership`, assertions, `datasetProfile`,
`datasetUsageStatistics`, and the governance tier the organisation already
declared on `globalTags` or `glossaryTerms`. The rules are exported as data, so
the weights you read are the weights that ran. **No language model is involved
in the decision on any path**, with or without an API key. A model's only job is
to write the ruling up afterwards, and it is handed the decision rather than
asked for one.

**Then the loop closes.** The ruling is written back as scoped structured
properties — `canon.status` is meaningless without `canon.subject`, so the two
are always written together — the dead staging copy is deprecated with a
replacement pointer, and the question is re-asked. A stock retrieval client on
plain MCP, which returned the staging copy before, now returns `FCT_ORDERS`. The
contribution is not "we wrote something back"; it is that the graph is
measurably better for the next consumer.

canon deliberately never writes a tier. Classifying an asset is the catalog's
job and DataHub already does it well; adjudicating between assets classified the
same is the job canon is for. A test asserts that no planned mutation ever
carries a tier tag, term or property, so that boundary is enforced rather than
promised.

### How we built it

TypeScript · Node 22 · DataHub OSS v1.7.0 (`datahub docker quickstart`) ·
`mcp-server-datahub` 3.4.5 over stdio · acryl-datahub SDK 1.7.0 · DataHub
`/openapi/v3/entity` for aspects MCP does not carry · DuckDB for the priced
comparison · Python and Poetry for the two warehouse queries · GitHub Pages.

### Challenges we ran into

- `get_entities` and `get_lineage` hang permanently after about six calls per
  server process, and the budget is spent per URN rather than per call — one
  read over twenty URNs wedges a fresh session. Mutation tools spend from the
  same budget. We measure a cost per call and respawn the server before it runs
  out.
- `get_entities` does not carry `upstreamLineage` edge types or `siblings`, and
  the `COPY`-versus-`TRANSFORMED` distinction is exactly what separates a
  landing copy from a modelled table. The same catalog scored 149 offline and
  102 over MCP until we supplemented from the platform's own aspect endpoint.
- Structured property values come back tagged by type. Reading `values[0]` as a
  string yields `[object Object]` and the ruling silently fails to read back.

### Accomplishments that we're proud of

- The falsification beat: poison the catalog on purpose — deprecate the winner,
  strip its owners, fail its assertions — and the ruling moves, on camera, then
  restores. A result that survives having its evidence removed was never reading
  the evidence.
- Abstention is a first-class outcome, not an error path. The product knows the
  difference between a question it can settle and one only a human can.
- 24 scenarios nobody hand-wrote, all 55 contested subjects in the catalog swept
  rather than the one that demos well, and 47 tests.

### What we learned

- Tiering and adjudication are compositional, not competing. Tiers narrow the
  field; a ruling decides what is left.
- A ruling needs a subject. A standing property on an asset cannot express "this
  is canonical *for this question*, as of this date, and here is how to retract
  it."
- Metadata quality is a product decision. Deprecating an operational source
  because it lost a comparison would write false metadata into a graph other
  people trust.

### What's next for canon

- Emit the ruling as a native DataHub Incident so abstentions route through the
  same queue teams already watch.
- Column-level adjudication, so a canonical table can still have a
  non-canonical measure.
- A GitHub Action that re-runs the ruling when a dbt model changes and comments
  the delta on the pull request.
- Contribute the aspect-coverage gap upstream so the supplementary REST read
  stops being necessary.

## 4. Public code repo

`https://github.com/Zen-cronic/canon`

## 5. Project test URL

`https://zen-cronic.github.io/canon/`

## 6. Artifact examples

`https://github.com/Zen-cronic/canon/tree/main/examples`

## 7. DataHub technologies used

Check only what is true: **DataHub OSS platform**, **MCP Server**.

## 8. Contributions to DataHub

Link the filed upstream issues.
