// Tests for the governance tier rule.
//
// Two things are being pinned here. One is that canon READS the catalog's own
// trust model, which is the composition claim. The other is that it never
// WRITES one — a tier is the catalog's classification of an asset, and a
// project that starts assigning tiers has stopped composing a shipped feature
// and started rebuilding it.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockDataHubClient } from "../src/datahub/mock.ts";
import { resolve } from "../src/agent/resolve.ts";
import { RULES } from "../src/agent/rules.ts";

const FIXTURE = "fixtures/catalog.json";
const ORDERS_DBT = "urn:li:dataset:(urn:li:dataPlatform:dbt,analytics.marts.fct_orders,PROD)";

const ordersOpts = {
  subject: "customer orders",
  question: "Where do I get customer orders?",
  searchQuery: "orders",
  force: true,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function withCatalog(mutate: (catalog: any) => void): MockDataHubClient {
  const catalog = JSON.parse(readFileSync(FIXTURE, "utf8"));
  mutate(catalog);
  const dir = mkdtempSync(join(tmpdir(), "canon-tier-"));
  const path = join(dir, "catalog.json");
  writeFileSync(path, JSON.stringify(catalog));
  return MockDataHubClient.load(path);
}

/** Replaces the winner's tags and returns its total and its tier hit. */
async function scoreWithTags(tags: string[]) {
  const client = withCatalog((c) => {
    for (const e of c.entities) if (e.urn === ORDERS_DBT) e.tags = tags;
  });
  const r = await resolve(client, ordersOpts);
  const score = r.adjudication?.scores.find((s) => s.urn === ORDERS_DBT);
  return {
    total: score?.total ?? 0,
    tier: score?.hits.find((h) => h.rule === "governance.tier") ?? null,
  };
}

test("TIER: the ladder is ordered, and each rung is worth what the table says", async () => {
  const t1 = await scoreWithTags(["urn:li:tag:Tier1"]);
  const t2 = await scoreWithTags(["urn:li:tag:Tier2"]);
  const t3 = await scoreWithTags(["urn:li:tag:Tier3"]);
  const none = await scoreWithTags([]);

  assert.equal(t1.tier?.delta, 16);
  assert.equal(t2.tier?.delta, 6);
  assert.equal(t3.tier?.delta, -12);
  assert.equal(none.tier, null, "an untiered asset should get no tier hit at all, not a zero one");

  assert.ok(t1.total > t2.total, "Tier 1 must outscore Tier 2");
  assert.ok(t2.total > t3.total, "Tier 2 must outscore Tier 3");
  assert.ok(t3.total < none.total, "a bottom-tier asset should score below an untiered one");
});

test("TIER: Certified is read as the top tier, in the vocabulary the catalog used", async () => {
  const certified = await scoreWithTags(["urn:li:tag:Certified"]);
  const tier1 = await scoreWithTags(["urn:li:tag:Tier1"]);

  assert.equal(certified.tier?.delta, tier1.tier?.delta, "same statement, different word");
  assert.match(String(certified.tier?.because), /Certified/);
  assert.match(String(tier1.tier?.because), /Tier1/);
});

test("TIER: Production is an environment, not a trust tier", async () => {
  const prod = await scoreWithTags(["urn:li:tag:Production"]);
  const none = await scoreWithTags([]);

  // Conflating these is how a staging copy sitting in the production account
  // ends up outranking a reviewed mart.
  assert.equal(prod.tier, null);
  assert.equal(prod.total, none.total);
});

test("TIER: a mid-migration asset carrying two tiers gets the higher one", async () => {
  const both = await scoreWithTags(["urn:li:tag:Tier3", "urn:li:tag:Tier1"]);
  assert.equal(both.tier?.delta, 16, "re-tiering should not silently demote an asset");
});

test("TIER: tiers are also read off glossary terms, not only tags", async () => {
  const client = withCatalog((c) => {
    for (const e of c.entities) {
      if (e.urn === ORDERS_DBT) {
        e.tags = [];
        e.glossaryTerms = ["urn:li:glossaryTerm:Tier2"];
      }
    }
  });
  const r = await resolve(client, ordersOpts);
  const hit = r.adjudication?.scores
    .find((s) => s.urn === ORDERS_DBT)
    ?.hits.find((h) => h.rule === "governance.tier");
  assert.equal(hit?.delta, 6);
});

test("TIER: canon never writes a tier — classification is the catalog's job", async () => {
  const client = MockDataHubClient.load(FIXTURE);
  const r = await resolve(client, ordersOpts);
  const planned = r.plan?.mutations ?? [];
  assert.ok(planned.length > 0, "the hero question should plan some writes");

  const TIERISH = /(tier[\s_-]?[123]|gold|silver|bronze|certified)/i;
  for (const m of planned) {
    if (m.kind === "addTag") {
      assert.ok(!TIERISH.test(m.tag), `canon planned a tier write: ${m.tag}`);
    }
    if (m.kind === "addGlossaryTerm") {
      assert.ok(!TIERISH.test(m.term), `canon planned a tier write: ${m.term}`);
    }
    if (m.kind === "setStructuredProperty") {
      assert.ok(
        !/tier/i.test(m.propertyUrn),
        `canon planned a tier structured property: ${m.propertyUrn}`,
      );
    }
  }
});

test("TIER: the rule table still exports exactly one tier rule, and names its aspects", () => {
  const tierRules = RULES.filter((r) => r.id === "governance.tier");
  assert.equal(tierRules.length, 1, "one tier rule, so nothing double-counts the same signal");
  assert.match(String(tierRules[0]?.aspect), /globalTags/);
  assert.match(String(tierRules[0]?.aspect), /glossaryTerms/);

  // The old `tag.certified` id is gone rather than living alongside the new
  // rule; two rules reading the same tag would score it twice.
  assert.equal(RULES.filter((r) => r.id === "tag.certified").length, 0);
  assert.equal(RULES.length, 22);
});
