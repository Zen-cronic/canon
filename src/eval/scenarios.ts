// Scenario generator for the un-stacked eval.
//
// The obvious objection to any adjudicator demo is that the fixture was written
// by the person who wrote the adjudicator, so of course it gets the right
// answer. This generator exists to answer that objection with numbers instead of
// a paragraph.
//
// How it stays honest:
//
//   * Ground truth is decided by CONSTRUCTION, before canon runs. The generator
//     picks an archetype, builds a catalog to match, and records which asset it
//     built to be canonical. Nothing here calls the scorer, imports a rule, or
//     looks at a weight.
//   * Names, platforms, layer counts, row magnitudes, owner names, staleness and
//     which optional signals are present are all drawn from a seeded PRNG. The
//     seed is a parameter, so `npm run eval -- --seed 99` is a different set of
//     scenarios and the numbers are expected to hold.
//   * Roughly a third of the scenarios are built to be UNANSWERABLE — two live
//     definitions, or a field stripped of every distinguishing signal. On those,
//     the correct behaviour is ABSTAIN, and confidently picking a winner is a
//     failure. An adjudicator that never abstains scores badly here on purpose.
//   * Adversarial signals are planted deliberately: the freshest table is often
//     an impostor, and the most-queried table is usually the wrong one, because
//     that is what the real failure looks like.
//
// Scenarios canon gets wrong are printed with the numbers, not filtered out.

import type {
  AssertionSummary,
  DatasetEntity,
  Owner,
  PlatformName,
  SchemaField,
  SubType,
  Urn,
} from "../datahub/types.ts";

/** Small deterministic PRNG (mulberry32) so a seed reproduces a scenario set. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;

const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
const int = (r: Rand, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
const chance = (r: Rand, p: number): boolean => r() < p;

const NOUNS = [
  "orders", "sessions", "shipments", "invoices", "subscriptions", "payments",
  "tickets", "bookings", "listings", "claims", "trips", "refunds", "accounts", "events",
] as const;

const QUALIFIERS = ["purchase", "vendor", "partner", "internal", "legacy", "draft"] as const;

const WAREHOUSES: readonly PlatformName[] = ["snowflake", "bigquery", "postgres"] as const;

const PEOPLE = [
  "maya.rodriguez", "tom.becker", "priya.n", "sam.oduya", "lin.wei", "jo.fischer",
  "ade.balogun", "nina.k", "rafa.costa", "hana.sato",
] as const;

const SERVICES = ["svc.fivetran", "svc.airbyte", "svc.dbt", "bi.looker", "svc.checkout"] as const;

const DAY = 86_400_000;

export type Scenario = {
  id: string;
  archetype: Archetype;
  subject: string;
  searchQuery: string;
  question: string;
  /** Decided at construction time. null means the correct answer is ABSTAIN. */
  truth: Urn | null;
  /** Why the generator says so — printed next to misses. */
  truthBecause: string;
  catalog: { generatedAt: number; note: string; platforms: string[]; entityCount: number; entities: DatasetEntity[]; queries: unknown[] };
};

export type Archetype =
  | "modelled-vs-copy"
  | "modelled-vs-raw"
  | "modelled-vs-snapshot"
  | "sibling-pair"
  | "popular-impostor"
  | "freshest-impostor"
  | "two-definitions"
  | "no-signal"
  | "single-candidate";

/** Archetypes and how often they appear. Abstain cases are ~1 in 3 by design. */
const ARCHETYPES: Array<{ name: Archetype; weight: number; abstain: boolean }> = [
  { name: "modelled-vs-copy", weight: 3, abstain: false },
  { name: "modelled-vs-raw", weight: 2, abstain: false },
  { name: "modelled-vs-snapshot", weight: 2, abstain: false },
  { name: "sibling-pair", weight: 2, abstain: false },
  { name: "popular-impostor", weight: 3, abstain: false },
  { name: "freshest-impostor", weight: 3, abstain: false },
  { name: "two-definitions", weight: 4, abstain: true },
  { name: "no-signal", weight: 2, abstain: true },
  { name: "single-candidate", weight: 1, abstain: false },
];

function chooseArchetype(r: Rand): { name: Archetype; abstain: boolean } {
  const total = ARCHETYPES.reduce((s, a) => s + a.weight, 0);
  let x = r() * total;
  for (const a of ARCHETYPES) {
    x -= a.weight;
    if (x <= 0) return a;
  }
  return ARCHETYPES[0] as { name: Archetype; abstain: boolean };
}

function datasetUrn(platform: PlatformName, name: string): Urn {
  return `urn:li:dataset:(urn:li:dataPlatform:${platform},${name},PROD)`;
}

function cols(r: Rand, noun: string, measures: string[]): SchemaField[] {
  const fields: SchemaField[] = [
    { fieldPath: `${noun.replace(/s$/, "")}_id`, nativeDataType: "varchar", nullable: false },
    { fieldPath: "customer_id", nativeDataType: "varchar", nullable: false },
    { fieldPath: chance(r, 0.5) ? "created_at" : "occurred_at", nativeDataType: "timestamp", nullable: false },
  ];
  for (const m of measures) fields.push({ fieldPath: m, nativeDataType: "numeric(18,2)", nullable: false });
  return fields;
}

function periodCols(r: Rand, dateCol: string, measure: string): SchemaField[] {
  return [
    { fieldPath: dateCol, nativeDataType: "date", nullable: false },
    { fieldPath: measure, nativeDataType: "numeric(18,2)", nullable: false },
    ...(chance(r, 0.4) ? [{ fieldPath: "row_count", nativeDataType: "bigint", nullable: false }] : []),
  ];
}

function owners(r: Rand, kinds: Array<Owner["type"]>): Owner[] {
  return kinds.map((type) => ({ owner: `urn:li:corpuser:${pick(r, PEOPLE)}`, type }));
}

function assertions(urn: Urn, passing: number, failing: number): AssertionSummary[] {
  const out: AssertionSummary[] = [];
  const types: AssertionSummary["type"][] = ["FRESHNESS", "VOLUME", "COLUMN"];
  for (let i = 0; i < passing; i++) {
    out.push({
      urn: `${urn}#pass-${i}`,
      type: types[i % 3] as AssertionSummary["type"],
      description: "generated check",
      lastResult: "SUCCESS",
    });
  }
  for (let i = 0; i < failing; i++) {
    out.push({
      urn: `${urn}#fail-${i}`,
      type: types[i % 3] as AssertionSummary["type"],
      description: "generated check",
      lastResult: "FAILURE",
    });
  }
  return out;
}

type Build = {
  platform: PlatformName;
  name: string;
  subType: SubType;
  schema: SchemaField[];
  upstreams?: Array<{ dataset: Urn; type: "TRANSFORMED" | "COPY" | "VIEW" }>;
  owners?: Owner[];
  tags?: Urn[];
  terms?: Urn[];
  description?: string;
  curated?: boolean;
  staleDays?: number;
  rows?: number;
  humanQueries?: number;
  serviceQueries?: number;
  passing?: number;
  failing?: number;
  deprecated?: string;
  siblings?: Urn[];
  siblingPrimary?: boolean;
  mutates?: boolean;
};

function entity(now: number, b: Build): DatasetEntity {
  const urn = datasetUrn(b.platform, b.name);
  const stale = b.staleDays ?? 0;
  const topUsers = [
    ...Array.from({ length: Math.min(4, Math.ceil((b.humanQueries ?? 0) / 60)) }, (_, i) => `urn:li:corpuser:${PEOPLE[i % PEOPLE.length]}`),
    ...Array.from({ length: Math.min(2, Math.ceil((b.serviceQueries ?? 0) / 500)) }, (_, i) => `urn:li:corpuser:${SERVICES[i % SERVICES.length]}`),
  ];
  return {
    urn,
    platform: b.platform,
    name: b.name,
    qualifiedName: b.name,
    subType: b.subType,
    description: b.description,
    descriptionIsCurated: b.curated,
    owners: b.owners ?? [],
    tags: b.tags ?? [],
    glossaryTerms: b.terms ?? [],
    schema: b.schema,
    deprecation: b.deprecated ? { deprecated: true, note: b.deprecated } : undefined,
    profile: { timestampMillis: now - stale * DAY, rowCount: b.rows ?? 1_000_000, columnCount: b.schema.length },
    usage: topUsers.length
      ? {
          windowDays: 30,
          totalSqlQueries: (b.humanQueries ?? 0) + (b.serviceQueries ?? 0),
          uniqueUserCount: topUsers.length,
          topUsers,
        }
      : undefined,
    operation: { lastUpdatedTimestamp: now - stale * DAY, operationType: b.mutates ? "UPDATE" : "INSERT" },
    upstreams: b.upstreams ?? [],
    siblings: b.siblings,
    siblingPrimary: b.siblingPrimary,
    assertions: assertions(urn, b.passing ?? 0, b.failing ?? 0),
  };
}

/** Builds one scenario. Ground truth is set here, before canon ever runs. */
export function makeScenario(seed: number, index: number, now: number): Scenario {
  const r = rng(seed * 7919 + index * 104729);
  const arch = chooseArchetype(r);
  const noun = pick(r, NOUNS);
  const subject = `${pick(r, ["customer", "company", "global", "daily"])} ${noun}`;
  const wh = pick(r, WAREHOUSES);
  const entities: DatasetEntity[] = [];
  let truth: Urn | null = null;
  let truthBecause = "";

  // A decoy that shares the head noun but is a different thing. Present in most
  // scenarios so triage has something real to reject.
  if (chance(r, 0.7)) {
    const q = pick(r, QUALIFIERS);
    entities.push(
      entity(now, {
        platform: pick(r, WAREHOUSES),
        name: `RAW.${q}_${noun}`,
        subType: "Table",
        schema: cols(r, noun, ["value"]),
        rows: int(r, 1_000, 9_000_000),
        staleDays: int(r, 0, 40),
      }),
    );
  }

  const measures = ["gross_amount_usd", "net_amount_usd"];

  switch (arch.name) {
    case "two-definitions": {
      // Same grain, genuinely different measure semantics, both healthy. No
      // metadata can pick — the right answer is to refuse.
      const a = entity(now, {
        platform: wh,
        name: `FINANCE.${noun}_daily`,
        subType: "Table",
        schema: periodCols(r, "revenue_date", "recognised_revenue_usd"),
        owners: owners(r, ["TECHNICAL_OWNER", "BUSINESS_OWNER"]),
        tags: ["urn:li:tag:Production", "urn:li:tag:Certified"],
        description: "Finance definition: net of refunds, excludes shipping.",
        curated: true,
        staleDays: 0,
        rows: 1461,
        passing: 2,
        humanQueries: int(r, 200, 900),
      });
      const b = entity(now, {
        platform: pick(r, WAREHOUSES),
        name: `GROWTH.${noun}_daily`,
        subType: "Table",
        schema: periodCols(r, "dt", "gross_bookings_usd"),
        owners: owners(r, ["TECHNICAL_OWNER", "BUSINESS_OWNER"]),
        tags: ["urn:li:tag:Production", "urn:li:tag:Certified"],
        description: "Growth definition: gross bookings including shipping.",
        curated: true,
        staleDays: 0,
        rows: 1461,
        passing: 2,
        humanQueries: int(r, 200, 900),
      });
      entities.push(a, b);
      truth = null;
      truthBecause = "two live definitions (NET vs GROSS) on the same grain; both owned, documented and current";
      break;
    }

    case "no-signal": {
      // Duplicates with nothing to tell them apart: no owners, no assertions,
      // no tags, no descriptions, same freshness. Refusing is correct.
      const n = int(r, 2, 3);
      for (let i = 0; i < n; i++) {
        entities.push(
          entity(now, {
            platform: pick(r, WAREHOUSES),
            name: `LAKE.copy${i + 1}_${noun}`,
            subType: "Table",
            schema: cols(r, noun, ["amount"]),
            staleDays: 1,
            rows: 5_000_000 + i,
          }),
        );
      }
      truth = null;
      truthBecause = `${n} indistinguishable copies: no owner, no assertion, no tag, no description on any of them`;
      break;
    }

    case "single-candidate": {
      const only = entity(now, {
        platform: wh,
        name: `MARTS.fct_${noun}`,
        subType: "Table",
        schema: cols(r, noun, measures),
        upstreams: [{ dataset: datasetUrn("postgres", `app.${noun}`), type: "TRANSFORMED" }],
        owners: owners(r, ["TECHNICAL_OWNER"]),
        tags: ["urn:li:tag:Production"],
        description: "The modelled table.",
        curated: true,
        staleDays: 0,
        rows: int(r, 1_000_000, 50_000_000),
        passing: int(r, 1, 3),
      });
      entities.push(only);
      truth = only.urn;
      truthBecause = "only one candidate answers to the subject";
      break;
    }

    default: {
      // Every remaining archetype shares a spine: a raw source, a landing copy,
      // and a modelled table built from the copy. The modelled table is the
      // truth; the archetype decides which impostor is made attractive.
      const rawName = `app.${noun}`;
      const raw = entity(now, {
        platform: "postgres",
        name: rawName,
        subType: "Table",
        schema: cols(r, noun, ["total_cents"]),
        owners: owners(r, ["TECHNICAL_OWNER"]),
        tags: ["urn:li:tag:Production", ...(chance(r, 0.5) ? ["urn:li:tag:PII"] : [])],
        description: "Application table. Rows mutate in place.",
        curated: true,
        staleDays: 0,
        rows: int(r, 10_000_000, 90_000_000),
        serviceQueries: int(r, 100_000, 2_000_000),
        mutates: true,
      });

      const copyName = `STAGING.stg_${noun}`;
      const copy = entity(now, {
        platform: wh,
        name: copyName,
        subType: "Table",
        schema: cols(r, noun, ["total_cents"]),
        upstreams: [{ dataset: raw.urn, type: "COPY" }],
        description: "Landing copy.",
        staleDays: arch.name === "freshest-impostor" ? 0 : int(r, 3, 12),
        rows: raw.profile!.rowCount - int(r, 1_000, 90_000),
        humanQueries: arch.name === "popular-impostor" ? int(r, 400, 2_000) : int(r, 0, 60),
        failing: arch.name === "freshest-impostor" ? 0 : 1,
      });

      const winner = entity(now, {
        platform: arch.name === "sibling-pair" ? "dbt" : wh,
        name: arch.name === "sibling-pair" ? `analytics.marts.fct_${noun}` : `MARTS.fct_${noun}`,
        subType: arch.name === "sibling-pair" ? "Incremental Model" : "Table",
        schema: cols(r, noun, measures),
        upstreams: [{ dataset: copy.urn, type: "TRANSFORMED" }],
        owners: owners(r, ["TECHNICAL_OWNER", "BUSINESS_OWNER"]),
        tags: ["urn:li:tag:Production", "urn:li:tag:Certified"],
        terms: [`urn:li:glossaryTerm:Commerce.${noun}`],
        description: "Modelled table. Business rules applied.",
        curated: true,
        // Deliberately NOT the freshest in the freshest-impostor archetype.
        staleDays: arch.name === "freshest-impostor" ? int(r, 1, 2) : 0,
        rows: copy.profile!.rowCount + int(r, 1_000, 40_000),
        // Deliberately NOT the most queried in the popular-impostor archetype.
        humanQueries: arch.name === "popular-impostor" ? int(r, 20, 90) : int(r, 60, 300),
        passing: int(r, 2, 3),
      });

      entities.push(raw, copy, winner);

      if (arch.name === "sibling-pair") {
        const materialised = entity(now, {
          platform: wh,
          name: `MARTS.FCT_${noun.toUpperCase()}`,
          subType: "Table",
          schema: cols(r, noun, measures.map((m) => m.toUpperCase())),
          upstreams: [{ dataset: winner.urn, type: "TRANSFORMED" }],
          owners: owners(r, ["TECHNICAL_OWNER"]),
          tags: ["urn:li:tag:Production", "urn:li:tag:Certified"],
          terms: [`urn:li:glossaryTerm:Commerce.${noun}`],
          description: "Warehouse materialisation.",
          staleDays: 0,
          rows: winner.profile!.rowCount,
          humanQueries: int(r, 40, 200),
        });
        materialised.siblings = [winner.urn];
        materialised.siblingPrimary = false;
        winner.siblings = [materialised.urn];
        winner.siblingPrimary = true;
        entities.push(materialised);
      }

      if (arch.name === "modelled-vs-snapshot") {
        entities.push(
          entity(now, {
            platform: "bigquery",
            name: `LEGACY.${noun}_snapshot_2024`,
            subType: "Snapshot",
            schema: cols(r, noun, ["amount"]),
            owners: owners(r, ["TECHNICAL_OWNER"]),
            tags: ["urn:li:tag:Deprecated"],
            description: "Frozen snapshot.",
            curated: true,
            staleDays: int(r, 300, 600),
            rows: Math.floor(winner.profile!.rowCount * 0.6),
            deprecated: "Frozen at 2024-12-31.",
          }),
        );
      }

      truth = winner.urn;
      truthBecause =
        arch.name === "popular-impostor"
          ? "modelled table wins although the landing copy has ~10x its human query volume"
          : arch.name === "freshest-impostor"
            ? "modelled table wins although the landing copy was written more recently"
            : arch.name === "sibling-pair"
              ? "dbt model is the definition; its warehouse sibling is the thing to query"
              : "modelled table: TRANSFORMED from the copy, owned, certified, assertions green";
      break;
    }
  }

  const platforms = [...new Set(entities.map((e) => e.platform))];
  return {
    id: `s${String(index + 1).padStart(2, "0")}-${arch.name}`,
    archetype: arch.name,
    subject,
    searchQuery: noun,
    question: `Which table should I use for ${subject}?`,
    truth,
    truthBecause,
    catalog: {
      generatedAt: now,
      note: `GENERATED SCENARIO (${arch.name}). Built by src/eval/scenarios.ts from a seeded PRNG. Ground truth set at construction, before any rule ran.`,
      platforms,
      entityCount: entities.length,
      entities,
      queries: [],
    },
  };
}

export function makeScenarios(seed: number, n: number, now: number): Scenario[] {
  return Array.from({ length: n }, (_, i) => makeScenario(seed, i, now));
}
