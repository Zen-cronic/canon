// Tests for contested-subject discovery.
//
// Discovery decides which questions canon is even asked, so getting it wrong is
// how you accidentally publish a flattering posture: cluster too loosely and
// everything looks contested, too tightly and only the hero question survives.

import assert from "node:assert/strict";
import { test } from "node:test";
import { MockDataHubClient } from "../src/datahub/mock.ts";
import {
  allEntities,
  conceptKey,
  findContested,
  summarisePosture,
  type SubjectOutcome,
} from "../src/eval/coverage.ts";

const FIXTURE = "fixtures/catalog.json";

test("COVERAGE: pipeline position is not a different concept", () => {
  const same = [
    "ecommerce_prod.public.orders",
    "ANALYTICS.STAGING.STG_ORDERS",
    "analytics.marts.fct_orders",
    "ANALYTICS.MARTS.FCT_ORDERS",
  ].map(conceptKey);
  assert.deepEqual(new Set(same), new Set(["order"]), "stg/fct/raw are stages, not nouns");
});

test("COVERAGE: grain words are stripped from either end", () => {
  // The abstain case depends on this: Finance's REVENUE_DAILY and Growth's
  // daily_revenue have to land in the same concept or canon is never asked.
  assert.equal(conceptKey("ANALYTICS.FINANCE.REVENUE_DAILY"), "revenue");
  assert.equal(conceptKey("growth_analytics.metrics.daily_revenue"), "revenue");
});

test("COVERAGE: a genuinely different noun stays a different concept", () => {
  // Supplier purchase orders are not customer orders. Merging them would make
  // canon rule across two unrelated questions and call it one.
  assert.notEqual(conceptKey("ANALYTICS.STAGING.stg_purchase_orders"), conceptKey("analytics.marts.fct_orders"));
  assert.equal(conceptKey("ANALYTICS.STAGING.stg_purchase_orders"), "purchase_order");
});

test("COVERAGE: snapshots and versions collapse into the thing they copy", () => {
  assert.equal(conceptKey("legacy_dw.reporting.orders_snapshot_2024"), "order");
  assert.equal(conceptKey("looker.orders_explore"), "order");
});

test("COVERAGE: a concept only one asset answers to is not contested", async () => {
  const client = MockDataHubClient.load(FIXTURE);
  const entities = await allEntities(client);
  const contested = findContested(entities);

  for (const c of contested) {
    assert.ok(c.members.length >= 2, `${c.subject} has ${c.members.length} member(s)`);
  }
  const keys = contested.map((c) => c.subject);
  assert.equal(new Set(keys).size, keys.length, "a concept must appear once");
  assert.ok(contested.some((c) => c.subject === "order"), "the hero question must be discovered");
  assert.ok(contested.some((c) => c.subject === "revenue"), "the abstain question must be discovered");
});

test("COVERAGE: discovery reads names, not evidence", async () => {
  // If discovery consulted scores it could quietly drop the subjects canon does
  // badly on. Two entities differing only in metadata must still be contested.
  const entities = await allEntities(MockDataHubClient.load(FIXTURE));
  const stripped = entities.map((e) => ({
    ...e,
    owners: [],
    tags: [],
    glossaryTerms: [],
    assertions: [],
    deprecation: undefined,
    description: undefined,
  }));
  assert.equal(
    findContested(stripped).length,
    findContested(entities).length,
    "stripping every governance signal must not change which subjects are contested",
  );
});

test("COVERAGE: every subject lands in exactly one posture bucket", () => {
  const outcomes: SubjectOutcome[] = [
    { subject: "a", candidates: 2, platforms: [], outcome: "RESOLVED", mechanism: "DUPLICATES", ms: 1, modelCalls: 0, graphReads: 1 },
    { subject: "b", candidates: 2, platforms: [], outcome: "ABSTAIN", mechanism: "COMPETING_DEFINITIONS", cause: "COMPETING_DEFINITIONS", missing: ["a named owner"], ms: 1, modelCalls: 0, graphReads: 1 },
    { subject: "c", candidates: 2, platforms: [], outcome: "ABSTAIN", mechanism: "INSUFFICIENT_SEPARATION", cause: "INSUFFICIENT_SEPARATION", missing: ["no owner is recorded on either"], ms: 1, modelCalls: 0, graphReads: 1 },
  ];
  const p = summarisePosture(100, outcomes);
  assert.equal(p.ruled + p.referredToOwners + p.needsMoreEvidence, p.contested);
  assert.equal(p.ruled, 1);
  assert.equal(p.referredToOwners, 1);
  assert.equal(p.needsMoreEvidence, 1);
});

test("COVERAGE: the backlog counts subjects, not complaints", () => {
  const outcomes: SubjectOutcome[] = [
    {
      subject: "a", candidates: 2, platforms: [], outcome: "ABSTAIN", mechanism: "INSUFFICIENT_SEPARATION",
      cause: "INSUFFICIENT_SEPARATION",
      // Three gripes of the same shape from one subject must count once.
      missing: ["no owner on x", "no owner on y", "no owner on z"],
      ms: 1, modelCalls: 0, graphReads: 1,
    },
    {
      subject: "b", candidates: 2, platforms: [], outcome: "ABSTAIN", mechanism: "INSUFFICIENT_SEPARATION",
      cause: "INSUFFICIENT_SEPARATION", missing: ["no owner on q"], ms: 1, modelCalls: 0, graphReads: 1,
    },
  ];
  const p = summarisePosture(10, outcomes);
  const owner = p.backlog.find((b) => /owner/.test(b.need));
  assert.equal(owner?.blocks, 2, "two subjects blocked on owners, not four complaints");
});
