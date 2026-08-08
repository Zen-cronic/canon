# canon — demo run-of-show

**Target 2:35. Hard cap 3:00** (hackathon rules: *"less than three (3) minutes"*,
YouTube/Vimeo/Youku, public, no third-party marks or copyrighted music).

Recorded against the **real report**, rendered by `npm run demo` from the
committed fixture catalog. Nothing is live-generated on camera and nothing is
mocked up: the page in frame is the page a judge can open.

## The sentence a tired judge repeats

> *"It works out which of five `orders` tables is the real one, and retires the
> other four."*

Every beat below either sets that sentence up or proves it. A beat that does
neither is cut.

## Screen-time by rubric weight

Five equally weighted criteria; **Use of DataHub is the tie-break**, so it gets
the most screen time and the best shot.

| criterion | seconds | where |
|---|---|---|
| 1 Use of DataHub (tie-break) | ~65s | acts 1 + 4 — lineage edge types, siblings, the write-back and read-back |
| 2 Technical Execution | ~35s | act 3 (priced from a real warehouse) + act 5 (the sweep) |
| 3 Originality | ~30s | act 6 (abstention) + act 2 (what the obvious rules do) |
| 4 Real-World Usefulness | ~30s | cold open ($829,966.60) + act 5b (what changed downstream) |
| 5 Submission Quality | whole | the report itself carries this |

## The cut

| time | beat | on screen | VO |
|---|---|---|---|
| **0:00–0:13** | **Cold open — the kill shot** | Hero. `$7,951,811.55` struck through → `$7,121,844.95`. Verdict line lands. | "Two dashboards, two revenue numbers, and the board deck goes out in the morning. Which one can I send?" *(beat)* "Neither. The number in the deck came from the wrong table — off by eight hundred and thirty thousand dollars." |
| **0:13–0:24** | **Name + claim** | Header chips: `257 entities · 7 platforms`. Scroll to the `orders` line. | "Five tables in this catalog answer to `orders`. canon works out which one is real." |
| **0:24–1:02** | **Act 1 — the evidence studio** *(heaviest beat)* | Click **▶ Play**. Lineage neighbourhood resolves; `TRANSFORMED` / `COPY` / `SIBLING` edges light; assertion chips pass/fail; candidates eliminate; `RESOLVED`. | "It reads the graph DataHub already has. Lineage — and crucially the *edge type*, because a copy and a modelled table are not the same claim. Siblings. Freshness. Ownership. Assertions. Twenty-two weighted rules, and **no model on the decision path**." |
| **1:02–1:20** | **Act 2 — the obvious rules pick wrong** | Scroll to baselines. Three strategies, three wrong answers. | "These aren't straw men. Name-matching, use-the-freshest, and social proof are what agents do today. On this catalog all three pick a table that is three days stale." |
| **1:20–1:40** | **Act 3 — priced, not estimated** | Scroll to the two SQL blocks. `3 days missing · 518 test orders · $334,160.03 refunds`. | "The gap is not a guess. Both figures are SELECTs against a warehouse built from a fixed seed. Three days missing, five hundred and eighteen internal test orders counted as revenue, and a third of a million in refunds never netted off." |
| **1:40–2:06** | **Act 4 — write-back + the one human click** | Scroll to the plan. **Click Approve.** `Applied.` Receipts render, transports named. Then **ask-twice**: the stock client now returns `FCT_ORDERS`. | "A ruling that stays in the agent is worth nothing. So canon writes it into DataHub — but deprecating a table other people trust is consequential, so canon plans and a **human applies**. That's the one decision it doesn't make. Then ask again: a stock client that returned the staging copy now returns the canonical table." |
| **2:06–2:24** | **Act 5 — every contested subject, not the one that demos** | Scroll to posture. The sweep table. Then the refusals column. | "One hand-picked question is what you'd show if it were the only one that worked. So: every concept more than one asset answers to, through the same adjudicator. The refusals are the interesting column — each abstention names what would settle it, so it reads as a metadata backlog, not a list of failures." |
| **2:24–2:40** | **Act 6 — and when it refuses** | Scroll to abstain. "What is our daily revenue?" Two tables, same grain, different measures → **ABSTAIN**. | "Same engine, different question. Two tables that measure genuinely different things. Ruling on that would launder a disagreement into a fact — so it refuses, and files the question to the owners who can settle it." |
| **2:40–2:52** | **End card** | Repo · Apache-2.0 · live URL · `no model on any decision path`. | "canon. Open source, and the ruling is a rule table you can read." |

## Direction notes

- **The rail is diegetic.** `#rail-urn` / `#rail-aspect` update as the page moves.
  Never narrate it — let a judge notice URNs and aspect names moving under the
  content. That is the Use-of-DataHub evidence, shown rather than claimed.
- **Mute-survivable.** Every beat must land with the sound off: struck-through
  number, chips changing state, `RESOLVED`, `Applied.`, `ABSTAIN`. Play the cut
  muted before calling it done — if the story survives, the takeaway is in the
  picture.
- **One human fulcrum click.** Approve is the only click that changes the world.
  Hold on it — pause before and after so it reads as a decision, not a step.
- **No competitive claims.** Never say "no other tool does this." The field
  sweep is strategy, never dialogue.
- **Do not say "Friday 4:55 PM."** Borrowed anchor, removed by operator
  decision 2026-08-05.

## Compliance gates

- [ ] under 3:00 · [ ] shows the real app running · [ ] public on YouTube
- [ ] marked **not made for kids** · [ ] no third-party marks or music
- [ ] English · [ ] uploaded early, not against the deadline
