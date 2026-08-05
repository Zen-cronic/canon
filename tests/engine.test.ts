// Tests for the properties the demo and the eval both depend on.
//
// These are the ones worth having. Each corresponds to a claim canon makes in
// public, and each would fail loudly if the adjudicator drifted back towards
// being a language model with a nice prompt.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockDataHubClient } from "../src/datahub/mock.ts";
import { resolve } from "../src/agent/resolve.ts";
import { triageStructurally } from "../src/agent/triage.ts";
import { partitionByDefinition, fingerprint } from "../src/agent/cohort.ts";
import { isTrulyDead } from "../src/agent/score.ts";
import { CANON_PROPERTIES } from "../src/datahub/properties.ts";

const ORDERS_DBT = "urn:li:dataset:(urn:li:dataPlatform:dbt,analytics.marts.fct_orders,PROD)";
const ORDERS_SF = "urn:li:dataset:(urn:li:dataPlatform:snowflake,ANALYTICS.MARTS.FCT_ORDERS,PROD)";
const ORDERS_STG = "urn:li:dataset:(urn:li:dataPlatform:snowflake,ANALYTICS.STAGING.STG_ORDERS,PROD)";
const ORDERS_PG = "urn:li:dataset:(urn:li:dataPlatform:postgres,ecommerce_prod.public.orders,PROD)";
const SNAPSHOT = "urn:li:dataset:(urn:li:dataPlatform:bigquery,legacy_dw.reporting.orders_snapshot_2024,PROD)";

const ordersOpts = {
  subject: "customer orders",
  question: "Where do I get customer orders?",
  searchQuery: "orders",
  force: true,
};

const FIXTURE = "fixtures/catalog.json";

/** Writes a modified copy of the catalog and returns a client reading it. */
function withCatalog(mutate: (catalog: any) => void): MockDataHubClient {
  const catalog = JSON.parse(readFileSync(FIXTURE, "utf8"));
  mutate(catalog);
  const dir = mkdtempSync(join(tmpdir(), "canon-test-"));
  const path = join(dir, "catalog.json");
  writeFileSync(path, JSON.stringify(catalog));
  return MockDataHubClient.load(path);
}

test("FALSIFIABLE: poisoning the winner changes the ruling", async () => {
  const clean = await resolve(MockDataHubClient.load(FIXTURE), ordersOpts);
  assert.equal(clean.ruling.canonical, ORDERS_DBT);

  // The exact attack the pre-submission audit used against the previous design:
  // deprecate the winner, strip its owners, fail every assertion. Under the old
  // fixture-replay adjudicator canon returned the poisoned table anyway, at
  // confidence "high", still citing the assertions it had just failed.
  const poisoned = await resolve(
    withCatalog((c) => {
      for (const e of c.entities) {
        if (e.urn === ORDERS_DBT) {
          e.deprecation = { deprecated: true, note: "DECOMMISSIONED. Do not use." };
          e.owners = [];
          e.tags = e.tags.filter((t: string) => !/Certified/.test(t));
          for (const a of e.assertions ?? []) a.lastResult = "FAILURE";
        }
      }
    }),
    ordersOpts,
  );

  assert.notEqual(poisoned.ruling.canonical, ORDERS_DBT, "a poisoned winner must not still win");
  assert.ok(
    poisoned.ruling.traps.some((t) => t.urn === ORDERS_DBT),
    "the poisoned table must appear as a trap, not as the answer",
  );
  const dbtScore = poisoned.adjudication!.scores.find((s) => s.urn === ORDERS_DBT)!;
  assert.ok(
    dbtScore.hits.some((h) => h.rule === "assertions.failing"),
    "the failing assertions must be visible in its arithmetic",
  );
});

test("DETERMINISTIC: the same catalog produces byte-identical rulings", async () => {
  const a = await resolve(MockDataHubClient.load(FIXTURE), ordersOpts);
  const b = await resolve(MockDataHubClient.load(FIXTURE), ordersOpts);
  assert.deepEqual(
    { canonical: a.ruling.canonical, scores: a.adjudication!.scores },
    { canonical: b.ruling.canonical, scores: b.adjudication!.scores },
  );
});

test("SCOPED DEPRECATION: only the dead landing copy is a blocker", async () => {
  const run = await resolve(MockDataHubClient.load(FIXTURE), ordersOpts);
  const blockers = run.ruling.traps.filter((t) => t.severity === "blocker").map((t) => t.urn);
  assert.deepEqual(blockers, [ORDERS_STG], "exactly one candidate may be deprecated: the stale COPY");

  const deprecations = run.plan!.mutations.filter((m) => m.kind === "setDeprecation");
  assert.equal(deprecations.length, 1);
  assert.equal((deprecations[0] as { entity: string }).entity, ORDERS_STG);
});

test("SCOPED DEPRECATION: the operational source is never deprecated, however badly it scores", async () => {
  const run = await resolve(MockDataHubClient.load(FIXTURE), ordersOpts);
  const pg = run.adjudication!.scores.find((s) => s.urn === ORDERS_PG)!;
  assert.ok(pg.total < 0, "the raw operational table should score badly — that is not the point");
  assert.ok(
    run.ruling.traps.find((t) => t.urn === ORDERS_PG)?.severity === "warning",
    "deprecating the table the checkout service writes to would be false metadata",
  );
  const evidence = run.evidence.find((e) => e.entity.urn === ORDERS_PG)!;
  assert.equal(isTrulyDead(evidence, run.evidence), false);
});

test("SCOPED DEPRECATION: an already-deprecated asset is not re-deprecated", async () => {
  const run = await resolve(MockDataHubClient.load(FIXTURE), ordersOpts);
  const evidence = run.evidence.find((e) => e.entity.urn === SNAPSHOT);
  if (evidence) assert.equal(isTrulyDead(evidence, run.evidence), false);
});

test("MECHANISM: same grain + different measure semantics is a definition conflict, not a duplicate", async () => {
  const run = await resolve(MockDataHubClient.load(FIXTURE), {
    subject: "daily revenue",
    question: "What is our daily revenue?",
    searchQuery: "revenue",
    force: true,
  });
  assert.equal(run.ruling.outcome, "ABSTAIN");
  assert.equal(run.ruling.mechanism.verdict, "COMPETING_DEFINITIONS");
  assert.match(run.ruling.mechanism.detail, /GROSS/);
  assert.match(run.ruling.mechanism.detail, /NET/);
});

test("MECHANISM: the orders candidates are duplicates, so a winner exists", async () => {
  const run = await resolve(MockDataHubClient.load(FIXTURE), ordersOpts);
  assert.equal(run.ruling.mechanism.verdict, "DUPLICATES");
  assert.equal(run.adjudication!.partition.classes.length, 1, "all five orders tables are one definition");
});

test("MECHANISM: gross and net columns fingerprint differently", () => {
  const gross = fingerprint({
    schema: [
      { fieldPath: "dt", nativeDataType: "DATE", nullable: false },
      { fieldPath: "gross_bookings_usd", nativeDataType: "NUMBER", nullable: false },
    ],
    glossaryTerms: [],
  } as never);
  const net = fingerprint({
    schema: [
      { fieldPath: "revenue_date", nativeDataType: "DATE", nullable: false },
      { fieldPath: "recognised_revenue_usd", nativeDataType: "NUMBER", nullable: false },
    ],
    glossaryTerms: [],
  } as never);
  assert.deepEqual(gross.markers, ["GROSS"]);
  assert.deepEqual(net.markers, ["NET"]);
  assert.equal(gross.periodGrain, true);
});

test("TRIAGE: every shortlisted URN came from the search results", async () => {
  const client = MockDataHubClient.load(FIXTURE);
  const search = await client.search("orders", { limit: 20 });
  const hitUrns = new Set(search.hits.map((h) => h.urn));
  const tri = triageStructurally("customer orders", search.hits);

  for (const urn of tri.shortlist) {
    assert.ok(hitUrns.has(urn), `shortlisted ${urn} was never returned by search`);
  }
  for (const d of tri.dismissed) {
    assert.ok(hitUrns.has(d.urn), `dismissed ${urn(d)} was never returned by search`);
  }
  assert.equal(
    tri.shortlist.length + tri.dismissed.length,
    search.hits.length,
    "every hit is accounted for as either shortlisted or dismissed",
  );
});

test("TRIAGE: purchase_orders is dismissed as a different noun, stg_orders is not", async () => {
  const client = MockDataHubClient.load(FIXTURE);
  const search = await client.search("orders", { limit: 20 });
  const tri = triageStructurally("customer orders", search.hits);

  const dismissedNames = tri.dismissed.map((d) => d.urn).join(" ");
  assert.match(dismissedNames, /purchase_orders/i, "the substring collision must be dismissed");
  assert.ok(tri.shortlist.includes(ORDERS_STG), "a warehouse layer prefix does not change the noun");
  assert.ok(tri.shortlist.includes(ORDERS_DBT));
  assert.ok(tri.shortlist.includes(ORDERS_SF));
});

test("PARTITION: a candidate with no readable schema is set aside, not ruled on", () => {
  const noSchema = {
    entity: { urn: "urn:x", schema: [], glossaryTerms: [], tags: [], owners: [], upstreams: [] },
  } as never;
  const p = partitionByDefinition([noSchema]);
  assert.equal(p.unreadable.length, 1);
  assert.equal(p.classes.length, 0);
});

function urn(d: { urn: string }): string {
  return d.urn;
}

test("CONTRACT: the Python ingest defines exactly the canon.* properties the writer uses", () => {
  // These two lists must agree or the write-back half-lands: values get set on
  // properties DataHub has never heard of, and the read-back cannot tell that
  // apart from "nothing was superseded". They disagreed once, which is why this
  // test exists.
  const py = readFileSync("bridge/ingest_catalog.py", "utf8");
  const defined = [...py.matchAll(/^\s*"(canon\.[a-z_]+)",/gm)].map((m) => m[1]).sort();
  const used = CANON_PROPERTIES.map((p) => p.replace("urn:li:structuredProperty:", "")).sort();
  assert.deepEqual(defined, used, "bridge/ingest_catalog.py and src/datahub/properties.ts disagree");
});

test("CONTRACT: no source file declares a canon.* property name of its own", () => {
  // properties.ts is the only place these strings may be written. Anything else
  // is a second source of truth waiting to drift.
  const offenders: string[] = [];
  for (const file of ["src/datahub/mock.ts", "src/datahub/live.ts", "src/agent/writeback.ts"]) {
    if (/["']urn:li:structuredProperty:canon\./.test(readFileSync(file, "utf8"))) offenders.push(file);
  }
  assert.deepEqual(offenders, [], "these files hard-code a canon.* URN instead of importing it");
});
