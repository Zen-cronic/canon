// The closing beat: ask the catalog again, with none of canon's code.
//
// This script is deliberately dumb. It opens the plain DataHub OSS MCP server,
// runs `search`, takes the hits, calls `get_entities`, and prints what it finds.
// It does not import the rule table, the scorer, the cohort partition or the
// resolver. It is a stand-in for the next agent that wanders into this catalog —
// a coding assistant, a text-to-SQL tool, someone's LangChain script.
//
// Before canon has ruled, a stock client sees a pile of similarly-named tables
// and nothing to choose between them. After canon has ruled and its write-back
// has been approved, the same stock client sees canon.status=canonical on one of
// them, a deprecation note on the dead copy pointing at the winner, and an
// evidence Document attached to both.
//
// That is the whole argument for writing back rather than just answering: the
// contribution is not visible in canon's output, it is visible in everyone
// else's.
//
//   npm run ask-once
//
// Requires a live DataHub (see RUNNING-LIVE.md). Reads only — this script
// cannot write anything.

import { spawnMcpServer } from "../src/datahub/mcp.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = Record<string, any>;

const QUERY = process.argv.includes("--query")
  ? (process.argv[process.argv.indexOf("--query") + 1] ?? "orders")
  : "orders";
const GMS = process.env.DATAHUB_GMS_URL ?? "http://localhost:8081";

const CANON_STATUS = "urn:li:structuredProperty:canon.status";
const CANON_SUBJECT = "urn:li:structuredProperty:canon.subject";
const CANON_SUPERSEDED = "urn:li:structuredProperty:canon.superseded_by";

function short(urn: string): string {
  const m = /urn:li:dataset:\(urn:li:dataPlatform:([^,]+),([^,]+),/.exec(urn);
  return m ? `${m[1]}:${m[2]}` : urn;
}

/** Reads structured properties + deprecation straight off the aspect endpoint. */
async function aspects(
  urn: string,
): Promise<{ props: Map<string, string>; deprecated?: string; deprecatedBy?: string }> {
  const url =
    `${GMS}/openapi/v3/entity/dataset/${encodeURIComponent(urn)}` +
    `?aspects=structuredProperties&aspects=deprecation`;
  const props = new Map<string, string>();
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return { props };
    const doc = (await res.json()) as Json;
    for (const p of doc["structuredProperties"]?.value?.properties ?? []) {
      const v = (p.values ?? [])[0];
      props.set(p.propertyUrn, typeof v === "object" && v !== null ? (v["string"] ?? v["double"] ?? "") : v);
    }
    const dep = doc["deprecation"]?.value;
    return {
      props,
      deprecated: dep?.deprecated ? (dep.note ?? "(no note)") : undefined,
      deprecatedBy: dep?.actor,
    };
  } catch {
    return { props };
  }
}

const mcp = await spawnMcpServer({ gmsUrl: GMS, token: process.env.DATAHUB_GMS_TOKEN, mutations: false });

try {
  console.log(`\nA stock MCP client, no canon code, asking the catalog for "${QUERY}".`);
  console.log(`server: ${mcp.serverInfo().name} ${mcp.serverInfo().version} — mutation tools OFF\n`);

  const res = await mcp.call<Json>("search", { query: QUERY, num_results: 20 });
  const hits: Json[] = res?.searchResults ?? [];
  const urns: string[] = hits.map((h) => h.entity?.urn).filter(Boolean);

  console.log(`search returned ${res?.total ?? urns.length} matches. Top ${urns.length}:\n`);

  let canonical: string | null = null;
  const retiredByCanon: string[] = [];
  const alreadyDeprecated: string[] = [];

  for (const urn of urns) {
    const { props, deprecated, deprecatedBy } = await aspects(urn);
    const status = props.get(CANON_STATUS);
    const subject = props.get(CANON_SUBJECT);
    const superseded = props.get(CANON_SUPERSEDED);

    let marker = "  ";
    if (status === "canonical") {
      marker = "->";
      canonical = urn;
    } else if (deprecated) {
      marker = "xx";
      // Only count what canon actually wrote. The 2024 snapshot shipped
      // deprecated; claiming credit for it would be the cheapest kind of lie.
      if (deprecatedBy === "urn:li:corpuser:canon") retiredByCanon.push(urn);
      else alreadyDeprecated.push(urn);
    } else if (superseded) {
      marker = " ·";
    }

    console.log(`${marker} ${short(urn)}`);
    if (status === "canonical") console.log(`     canon.status = canonical  (for "${subject}")`);
    if (superseded) console.log(`     canon.superseded_by = ${short(String(superseded))}`);
    if (deprecated) {
      const who = deprecatedBy === "urn:li:corpuser:canon" ? "by canon" : `by ${String(deprecatedBy ?? "someone else").split(":").pop()}`;
      console.log(`     DEPRECATED ${who}: ${String(deprecated).slice(0, 110)}`);
    }
  }

  console.log();
  if (canonical) {
    console.log(`The catalog now answers the question by itself: ${short(canonical)}.`);
    if (retiredByCanon.length) {
      console.log(
        `${retiredByCanon.length} candidate${retiredByCanon.length === 1 ? " was" : "s were"} retired by canon, with a note pointing at the winner:`,
      );
      for (const r of retiredByCanon) console.log(`  xx ${short(r)}`);
      console.log("A client that reads deprecation will not offer those at all.");
    }
    if (alreadyDeprecated.length) {
      console.log(
        `\n${alreadyDeprecated.length} other candidate${alreadyDeprecated.length === 1 ? " was" : "s were"} already deprecated before canon ran — not canon's doing:`,
      );
      for (const r of alreadyDeprecated) console.log(`  ·· ${short(r)}`);
    }
    console.log("\nNone of this came from canon at runtime. canon wrote it and left.");
  } else {
    console.log("No canon ruling on this subject yet: a stock client sees only similarly-named tables");
    console.log("and has nothing to choose between them. Run the demo with --approve first.");
  }
  console.log();
} finally {
  await mcp.close();
  process.exit(0);
}
