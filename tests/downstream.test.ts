// Tests for the downstream measurement.
//
// The measurement's whole value is that it is not rigged, so these tests are
// mostly about the ways it could be. Two of them would fail if someone made the
// obvious "improvement" of scoring canon against its own ruling.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { MockDataHubClient } from "../src/datahub/mock.ts";
import { applyApproved, resolve } from "../src/agent/resolve.ts";
import {
  DOWNSTREAM_QUESTIONS,
  controlViolations,
  measure,
  summarise,
  type DownstreamDelta,
} from "../src/eval/downstream.ts";

const ORDERS = DOWNSTREAM_QUESTIONS.find((q) => q.subject === "customer orders")!;
const REVENUE = DOWNSTREAM_QUESTIONS.find((q) => q.subject === "daily revenue")!;

/** Runs every question through canon, measuring either side of the write-back. */
async function runAll(): Promise<DownstreamDelta[]> {
  const client = MockDataHubClient.load("fixtures/catalog.json");
  const before = new Map<string, Awaited<ReturnType<typeof measure>>>();
  for (const q of DOWNSTREAM_QUESTIONS) before.set(q.subject, await measure(client, q));

  for (const q of DOWNSTREAM_QUESTIONS) {
    const r = await resolve(client, {
      subject: q.subject,
      question: q.question,
      searchQuery: q.query,
      force: true,
    });
    await applyApproved(client, r);
  }

  const out: DownstreamDelta[] = [];
  for (const q of DOWNSTREAM_QUESTIONS) {
    out.push({ question: q, before: before.get(q.subject)!, after: await measure(client, q) });
  }
  return out;
}

test("the ranking strategies import none of canon's decision code", () => {
  const src = readFileSync("src/eval/downstream.ts", "utf8");
  const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1] ?? "");
  for (const spec of imports) {
    assert.ok(
      !spec.includes("/agent/"),
      `src/eval/downstream.ts imports ${spec}; the stock-client claim requires it import no agent code`,
    );
  }
  // Belt and braces: the words themselves should not appear as module paths.
  for (const forbidden of ["rules.ts", "score.ts", "cohort.ts", "resolve.ts", "narrate.ts"]) {
    assert.ok(
      !imports.some((i) => i.endsWith(forbidden)),
      `src/eval/downstream.ts must not import ${forbidden}`,
    );
  }
});

test("ground truth is declared, not read back from a ruling", async () => {
  // If the correct answer were sourced from canon's output, deleting canon's
  // write-back would change it. It must not.
  const client = MockDataHubClient.load("fixtures/catalog.json");
  const clean = await measure(client, ORDERS);
  assert.equal(clean.length, 3);
  assert.ok(ORDERS.acceptable.length > 0, "the hero question needs a declared right answer");
  assert.ok(
    ORDERS.acceptable.every((u) => u.startsWith("urn:li:dataset:")),
    "ground truth should be literal URNs, fixed in the file",
  );
});

test("a metadata-blind client ranks the impostor above the truth, before and after", async () => {
  const deltas = await runAll();
  const orders = deltas.find((d) => d.question.subject === "customer orders")!;
  const before = orders.before.find((s) => s.strategy === "top-hit")!;
  const after = orders.after.find((s) => s.strategy === "top-hit")!;

  assert.ok(before.trapRank !== null, "the impostor should be served to a top-hit client");
  assert.ok(before.rankOfCorrect !== null);
  assert.ok(
    before.trapRank < before.rankOfCorrect,
    `the incident is that the impostor outranks the truth: got trap #${before.trapRank}, correct #${before.rankOfCorrect}`,
  );
  // Nothing canon writes can reach a client that reads no metadata. Saying so
  // is the honest limit; asserting it keeps the README honest too.
  assert.equal(after.trapRank, before.trapRank);
  assert.equal(after.rankOfCorrect, before.rankOfCorrect);
});

test("the write-back stops a governance-aware client serving the impostor", async () => {
  const deltas = await runAll();
  const orders = deltas.find((d) => d.question.subject === "customer orders")!;

  for (const id of ["governance-aware", "canonical-marker"] as const) {
    const before = orders.before.find((s) => s.strategy === id)!;
    const after = orders.after.find((s) => s.strategy === id)!;
    assert.ok(before.trapRank !== null, `${id} should serve the impostor before the ruling`);
    assert.equal(after.trapRank, null, `${id} should not serve the impostor after the ruling`);
    assert.equal(after.offeredCount, before.offeredCount - 1);
  }
});

test("a governance-aware client was already right on this catalog — the claim is not inflated", async () => {
  const deltas = await runAll();
  const orders = deltas.find((d) => d.question.subject === "customer orders")!;
  const before = orders.before.find((s) => s.strategy === "governance-aware")!;

  // This is the uncomfortable result, pinned so nobody can quietly publish a
  // bigger one. Governance metadata already ranked the right table first.
  assert.equal(before.rankOfCorrect, 1);
  assert.equal(before.correctAtOne, true);
});

test("the abstain control does not move", async () => {
  const deltas = await runAll();
  assert.deepEqual(controlViolations(deltas), []);

  const revenue = deltas.find((d) => d.question.subject === REVENUE.subject)!;
  for (const before of revenue.before) {
    const after = revenue.after.find((s) => s.strategy === before.strategy)!;
    assert.deepEqual(
      after.offers.map((o) => [o.urn, o.rank]),
      before.offers.map((o) => [o.urn, o.rank]),
      `${before.strategy} moved on a question canon abstained from`,
    );
  }
});

test("the summary excludes the control from its denominators", async () => {
  const deltas = await runAll();
  const summary = summarise(deltas);
  assert.equal(summary.length, 3);
  for (const s of summary) {
    assert.equal(s.scored, 1, "only the one question with a declared answer should be scored");
  }
});

test("the canonical marker is matched by value, not by canon's property names", async () => {
  const client = MockDataHubClient.load("fixtures/catalog.json");
  const r = await resolve(client, {
    subject: ORDERS.subject,
    question: ORDERS.question,
    searchQuery: ORDERS.query,
    force: true,
  });
  await applyApproved(client, r);

  // Rewrite the property URNs to a foreign vendor's namespace. A strategy that
  // hardcoded `canon.status` would stop working; this one must not.
  const [winner] = await client.getEntities([r.ruling.canonical!]);
  const renamed = (winner!.structuredProperties ?? []).map((p) => ({
    ...p,
    propertyUrn: p.propertyUrn.replace("canon.", "someOtherTool."),
  }));
  winner!.structuredProperties = renamed;

  const foreign = {
    ...ORDERS,
    // Point the measurement at a client whose entity carries the renamed props.
    acceptable: ORDERS.acceptable,
  };
  const patched = {
    ...client,
    mode: client.mode,
    search: client.search.bind(client),
    getEntities: async (urns: string[]) =>
      (await client.getEntities(urns)).map((e) => (e.urn === winner!.urn ? winner! : e)),
  } as unknown as MockDataHubClient;

  const results = await measure(patched, foreign);
  const marker = results.find((s) => s.strategy === "canonical-marker")!;
  assert.equal(marker.pick, winner!.urn, "the marker convention should survive being renamed");
});
