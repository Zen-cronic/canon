import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "../src/datahub/client.ts";
import { MockDataHubClient } from "../src/datahub/mock.ts";
import { resolve } from "../src/agent/resolve.ts";

const ORDERS_DBT = "urn:li:dataset:(urn:li:dataPlatform:dbt,analytics.marts.fct_orders,PROD)";
const ORDERS_SF = "urn:li:dataset:(urn:li:dataPlatform:snowflake,ANALYTICS.MARTS.FCT_ORDERS,PROD)";
const ORDERS_STG = "urn:li:dataset:(urn:li:dataPlatform:snowflake,ANALYTICS.STAGING.STG_ORDERS,PROD)";

const ordersOpts = {
  subject: "customer orders",
  question: "Where do I get customer orders?",
  searchQuery: "orders",
};

test("fixture catalog is realistically sized and multi-platform", async () => {
  const client = MockDataHubClient.load();
  const stats = client.stats();
  assert.ok(stats.entities > 200, `expected a realistic catalog, got ${stats.entities} entities`);
  assert.ok(stats.platforms >= 6, `expected multiple platforms, got ${stats.platforms}`);
});

test("search returns genuine noise, not a curated shortlist", async () => {
  const client = await createClient();
  const res = await client.search("orders", { limit: 20 });
  assert.ok(res.total > 6, "search should surface substring collisions, not just the hero cluster");
  const names = res.hits.map((h) => h.name).join(" ");
  assert.match(names, /purchase_orders/, "purchase_orders is the realistic collision and must appear");
});

test("the naive strategies do not all agree with canon", async () => {
  const client = await createClient();
  const run = await resolve(client, { ...ordersOpts, force: true });
  const picks = run.baselines.map((b) => b.pick);
  assert.ok(
    picks.some((p) => p !== ORDERS_DBT && p !== ORDERS_SF),
    "at least one baseline must pick something canon rejects, or the premise is false",
  );
});

test("canon resolves customer orders to the dbt mart and names its sibling", async () => {
  const client = await createClient();
  const run = await resolve(client, { ...ordersOpts, force: true });
  assert.equal(run.ruling.outcome, "RESOLVED");
  assert.equal(run.ruling.canonical, ORDERS_DBT);
  assert.equal(run.ruling.queryThis, ORDERS_SF, "dbt model and warehouse table are one logical asset");
  assert.ok(run.ruling.traps.length >= 3, "the traps are the product; there should be several");
  assert.ok(
    run.ruling.traps.some((t) => t.urn === ORDERS_STG && t.severity === "blocker"),
    "the stale staging copy must be flagged as a blocker",
  );
});

test("nothing is written without approval", async () => {
  const client = await createClient();
  const run = await resolve(client, { ...ordersOpts, force: true });
  assert.ok(run.plan, "a plan should always be produced");
  assert.ok(run.plan!.mutations.length > 0, "the plan should contain mutations");
  assert.equal(run.write, undefined, "no write may happen without approve:true");

  const reread = await client.getCanonRuling("customer orders");
  assert.equal(reread, null, "the graph must be untouched when approval was not given");
});

test("approved write-back applies and verifies by re-reading the graph", async () => {
  const client = await createClient();
  const run = await resolve(client, { ...ordersOpts, force: true, approve: true });
  assert.ok(run.write, "approve:true must produce a write result");
  assert.ok(run.write!.receipts.every((r) => r.applied), "every planned mutation should apply");
  assert.equal(run.write!.verification.ok, true, run.write!.verification.detail);
  assert.equal(run.write!.verification.reread?.canonicalUrn, ORDERS_DBT);
});

test("asking twice: the second answer comes from the graph with no model call", async () => {
  const client = await createClient();
  const first = await resolve(client, { ...ordersOpts, force: true, approve: true });
  assert.equal(first.answeredBy, "agent");
  assert.ok(first.totals.modelCalls > 0, "the first ask requires model judgment");

  const second = await resolve(client, ordersOpts);
  assert.equal(second.answeredBy, "graph");
  assert.equal(second.totals.modelCalls, 0, "the whole thesis: the second ask needs no model");
  assert.equal(second.ruling.canonical, ORDERS_DBT);
});

test("write-back is durable: deprecation and supersededBy land on the traps", async () => {
  const client = await createClient();
  await resolve(client, { ...ordersOpts, force: true, approve: true });
  const [stg] = await client.getEntities([ORDERS_STG]);
  assert.ok(stg, "staging table should still exist after write-back");
  assert.equal(stg!.deprecation?.deprecated, true, "the blocker trap must be deprecated");
  assert.match(stg!.deprecation!.note!, /fct_orders/, "the note must point at the winner");
});

test("canon abstains rather than inventing a winner, and writes no canonical claim", async () => {
  const client = await createClient();
  const run = await resolve(client, {
    subject: "daily revenue",
    question: "What is our daily revenue?",
    searchQuery: "revenue",
    force: true,
    approve: true,
  });
  assert.equal(run.ruling.outcome, "ABSTAIN");
  assert.equal(run.ruling.canonical, undefined);
  assert.ok((run.ruling.missingEvidence ?? []).length > 0, "an abstention must say what would settle it");
  assert.ok(
    run.plan!.mutations.some((m) => m.kind === "createProposal"),
    "abstaining still contributes: the open question goes back to the owners",
  );
  assert.equal(run.write!.verification.ok, true, "verification must confirm no canonical claim was written");
  assert.equal(await client.getCanonRuling("daily revenue"), null);
});

test("a replayed ruling is always labelled as a fixture, never as live output", async () => {
  const client = await createClient();
  const run = await resolve(client, { ...ordersOpts, force: true });
  if (run.ruling.provenance.source === "replay") {
    assert.match(run.ruling.provenance.note ?? "", /FIXTURE/i);
  }
});
