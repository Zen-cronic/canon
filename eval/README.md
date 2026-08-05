# Evaluation

Two things are measured here. Run both with `npm run eval`.

---

## 1. Ablation — the heuristics canon has to beat

One question, one catalog, four selection strategies.

| Strategy | What it is, in practice | Picks | |
|---|---|---|---|
| **canon** | Weighted evidence over the context graph | `dbt:analytics.marts.fct_orders` | **correct** |
| top-search-hit | What a name-matching agent does: take the first search result | `snowflake:ANALYTICS.STAGING.stg_purchase_orders` | wrong |
| freshest | "Whichever table was written to most recently must be the live one" | `postgres:ecommerce_prod.public.orders` | wrong |
| most-queried-by-humans | "Whatever my colleagues query must be right" | `snowflake:ANALYTICS.STAGING.STG_ORDERS` | wrong |

Three strategies, three *different* wrong tables, one question. Each fails in its
own way and the failures are the interesting part:

- **top-search-hit** lands on `stg_purchase_orders` — a different noun that
  happens to end in the same word. Substring collision, not a data problem.
- **freshest** lands on the operational table the checkout service writes to.
  It is the freshest thing in the catalog by construction, and it is never the
  right answer for analytics: rows mutate in place and no business rules have
  been applied.
- **most-queried-by-humans** lands on the stale staging copy — which is exactly
  what happened to the analyst in the demo. Four people query it every week. It
  is three days behind with a failing freshness assertion and no owner. Its
  popularity is evidence of a live problem, not evidence that it is canonical.

That last row is why `usage.human_adoption` is capped at +6 in the rule table
while a passing assertion is worth +14. The weighting *is* the argument.

**What this is not.** Three cases on one hand-authored catalog. It shows the
naive strategies fail in distinct, explainable ways on realistic metadata. It is
not a benchmark and it supports no percentage claim. That is what the next
section is for.

---

## 2. Un-stacked eval — scenarios nobody hand-wrote

The fair objection to any adjudicator demo is that the fixture was written by the
person who wrote the adjudicator. So the scenarios here are generated.

**How it stays honest** (generator: [`src/eval/scenarios.ts`](../src/eval/scenarios.ts)):

- **Ground truth is set at construction.** The generator picks an archetype,
  builds a catalog to match, and records which asset it built to be canonical —
  before anything runs. The generator imports no rule, no weight, and never calls
  the scorer. `grep -n "rules\|score\|adjudicate" src/eval/scenarios.ts` returns
  nothing.
- **Seeded, and the seed is a parameter.** `npm run eval -- --seed 99 --n 40` is
  a different draw. Names, platforms, row counts, staleness, owner names and
  which optional signals exist are all drawn from the PRNG.
- **A third of the scenarios have no right answer.** Two live definitions, or a
  set of copies stripped of every distinguishing signal. On those the correct
  behaviour is ABSTAIN, and confidently naming a winner is scored as a failure.
  An adjudicator that always answers scores badly here on purpose.
- **The traps are adversarial by construction.** In `popular-impostor` the wrong
  table has ~10× the human query volume of the right one. In `freshest-impostor`
  the wrong table was written more recently. These are the cases where a
  plausible heuristic wins and the answer is still wrong.

### Results at the reference seed

```
seed 20260805, n = 24

correct pick      12/12
correct abstain   11/12
false confidence  1      ruled on a question that has no answer
over-abstention   0      refused a question that had one
```

| Archetype | | |
|---|---|---|
| `modelled-vs-copy` | 5/5 | |
| `modelled-vs-snapshot` | 2/2 | |
| `popular-impostor` | 4/4 | the wrong table is ~10× more queried |
| `sibling-pair` | 1/1 | dbt model named, warehouse sibling given as the thing to query |
| `two-definitions` | 8/8 | correctly refused |
| `no-signal` | **3/4** | **one miss, below** |

CI reruns this exact draw on every push (`npm run eval:ci`) and asserts the
counts above, including the miss. A threshold would let the result drift under a
green build; exact counts mean any change to the rule table has to be looked at
and this file updated in the same commit.

### The miss, in full

```
s10-no-signal   "daily trips"
  expected: ABSTAIN
            2 indistinguishable copies: no owner, no assertion,
            no tag, no description on any of them
  got:      snowflake:RAW.legacy_trips   (DUPLICATES)
```

**What happened.** The scenario built two deliberately indistinguishable copies
of a `trips` table, so the intended answer was "refuse". But the catalog also
contained a noun-sharing decoy, `RAW.legacy_trips`. canon's structural triage
treats `legacy` as a warehouse layer prefix — the same class as `stg`, `fct`,
`raw` — so `legacy_trips` was shortlisted as the same noun rather than dismissed
as a different one. It carried signals the two copies did not, canon separated
it from them, and it ruled.

**Is that a bug?** Partly in each direction, which is why it is published rather
than fixed.

- The triage behaviour is defensible: `legacy_orders` really is orders, and
  dismissing it would be worse — a legacy table is exactly the kind of thing a
  person might still be querying and needs to be told about.
- The ruling is still wrong for the scenario as designed. The generator asserted
  "nothing here can be told apart", and canon found something that could be.

**Why it was not fixed.** The fix is either to teach the generator not to emit
that decoy in the `no-signal` archetype, or to widen the abstention rule until
this case falls into it. The first is tuning the test until the product looks
good. The second changes the product to fit one generated scenario. Both are
worse than reporting it: the number in the README is `11/12`, and this is the
one.

### Other seeds

Not cherry-picked — the reference seed is the one with the miss.

| Draw | correct pick | correct abstain | false confidence |
|---|---|---|---|
| `--seed 20260805 --n 24` (reference) | 12/12 | 11/12 | 1 |
| `--seed 99 --n 40` | 33/33 | 7/7 | 0 |
| `--seed 7 --n 40` | 24/24 | 16/16 | 0 |

### Reproducing

```bash
npm run eval                      # both evaluations, reference seed
npm run eval -- --seed 99 --n 40  # a different draw
npm run eval -- --json            # machine-readable; committed at examples/eval-report.json
npm run eval:ci                    # the gate CI runs
```

No credentials, no DataHub instance, no network.
