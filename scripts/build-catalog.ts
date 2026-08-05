// Builds fixtures/catalog.json — the messy catalog canon reasons over.
//
// Why a builder and not hand-written JSON: the interesting entities are authored
// by hand below (they carry the actual ambiguity), and the builder surrounds them
// with enough realistic bulk that search returns a real catalog's worth of noise.
// The OUTPUT is committed; nothing at demo time runs this. `npm run build:catalog`
// regenerates it deterministically.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DatasetEntity,
  PlatformName,
  RecordedQuery,
  SubType,
  Urn,
} from "../src/datahub/types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/**
 * Frozen reference clock. Every freshness claim in the demo is relative to this,
 * so "3 days stale" still reads as 3 days stale during the judging window.
 */
const NOW = Date.parse("2026-08-02T09:00:00Z");
const DAY = 86_400_000;
const HOUR = 3_600_000;

const ds = (platform: PlatformName, name: string): Urn =>
  `urn:li:dataset:(urn:li:dataPlatform:${platform},${name},PROD)`;
const user = (u: string): Urn => `urn:li:corpuser:${u}`;
const term = (t: string): Urn => `urn:li:glossaryTerm:${t}`;
const tag = (t: string): Urn => `urn:li:tag:${t}`;
const domain = (d: string): Urn => `urn:li:domain:${d}`;

// The orders cluster — the hero ambiguity

const ORDERS_RAW = ds("postgres", "ecommerce_prod.public.orders");
const ORDERS_STG = ds("snowflake", "ANALYTICS.STAGING.STG_ORDERS");
const ORDERS_DBT = ds("dbt", "analytics.marts.fct_orders");
const ORDERS_SF = ds("snowflake", "ANALYTICS.MARTS.FCT_ORDERS");
const ORDERS_LEGACY = ds("bigquery", "legacy_dw.reporting.orders_snapshot_2024");
const ORDERS_EXPLORE = ds("looker", "orders_explore");

// The revenue cluster — genuinely undecidable, on purpose

const REV_FINANCE = ds("snowflake", "ANALYTICS.FINANCE.REVENUE_DAILY");
const REV_GROWTH = ds("bigquery", "growth_analytics.metrics.daily_revenue");

// The customer-contact cluster — the governance trap

const CUST_RAW = ds("postgres", "ecommerce_prod.public.customers");
const CUST_MARKETING = ds("snowflake", "ANALYTICS.MARTS.DIM_CUSTOMER_CONTACTABLE");
const CUST_EXPORT = ds("s3", "data-exports/adhoc/customer_email_dump_2025_11");

const heroEntities: DatasetEntity[] = [
  {
    urn: ORDERS_RAW,
    platform: "postgres",
    name: "ecommerce_prod.public.orders",
    qualifiedName: "ecommerce_prod.public.orders",
    subType: "Table",
    description:
      "Application table backing the checkout service. Rows are mutated in place on refund/cancel.",
    descriptionIsCurated: true,
    owners: [{ owner: user("dev.platform"), type: "TECHNICAL_OWNER" }],
    tags: [tag("Production"), tag("PII")],
    glossaryTerms: [],
    domain: domain("Commerce"),
    schema: [
      { fieldPath: "id", nativeDataType: "bigint", nullable: false },
      { fieldPath: "customer_id", nativeDataType: "bigint", nullable: false },
      { fieldPath: "status", nativeDataType: "varchar(32)", nullable: false },
      { fieldPath: "total_cents", nativeDataType: "bigint", nullable: false },
      { fieldPath: "created_at", nativeDataType: "timestamptz", nullable: false },
      { fieldPath: "updated_at", nativeDataType: "timestamptz", nullable: false },
    ],
    profile: { timestampMillis: NOW - 2 * HOUR, rowCount: 48_211_904, columnCount: 6 },
    usage: { windowDays: 30, totalSqlQueries: 1_204_882, uniqueUserCount: 2, topUsers: [user("svc.fivetran"), user("svc.checkout")] },
    operation: { lastUpdatedTimestamp: NOW - 4 * 60_000, operationType: "UPDATE" },
    upstreams: [],
    assertions: [],
  },
  {
    urn: ORDERS_STG,
    platform: "snowflake",
    name: "ANALYTICS.STAGING.STG_ORDERS",
    qualifiedName: "ANALYTICS.STAGING.STG_ORDERS",
    subType: "Table",
    description: "Landing copy of orders.",
    descriptionIsCurated: false,
    owners: [],
    tags: [],
    glossaryTerms: [],
    domain: domain("Commerce"),
    schema: [
      { fieldPath: "id", nativeDataType: "NUMBER(38,0)", nullable: false },
      { fieldPath: "customer_id", nativeDataType: "NUMBER(38,0)", nullable: false },
      { fieldPath: "status", nativeDataType: "VARCHAR(32)", nullable: true },
      { fieldPath: "total_cents", nativeDataType: "NUMBER(38,0)", nullable: true },
      { fieldPath: "created_at", nativeDataType: "TIMESTAMP_NTZ", nullable: true },
      { fieldPath: "_loaded_at", nativeDataType: "TIMESTAMP_NTZ", nullable: true },
    ],
    profile: { timestampMillis: NOW - 3 * DAY - 2 * HOUR, rowCount: 47_880_112, columnCount: 6 },
    usage: { windowDays: 30, totalSqlQueries: 419, uniqueUserCount: 4, topUsers: [user("maya.rodriguez"), user("tom.becker"), user("priya.n"), user("intern.jess")] },
    operation: { lastUpdatedTimestamp: NOW - 3 * DAY - 2 * HOUR, operationType: "INSERT" },
    upstreams: [{ dataset: ORDERS_RAW, type: "COPY" }],
    assertions: [
      {
        urn: "urn:li:assertion:stg-orders-freshness",
        type: "FRESHNESS",
        description: "STG_ORDERS loaded within the last 24 hours",
        lastResult: "FAILURE",
      },
    ],
  },
  {
    urn: ORDERS_DBT,
    platform: "dbt",
    name: "analytics.marts.fct_orders",
    qualifiedName: "analytics.marts.fct_orders",
    subType: "Incremental Model",
    description:
      "Order grain fact table. One row per order, refunds netted, test orders excluded, currency normalised to USD. This is the order table analytics should build on.",
    descriptionIsCurated: true,
    owners: [
      { owner: user("maya.rodriguez"), type: "TECHNICAL_OWNER" },
      { owner: user("finance.analytics"), type: "BUSINESS_OWNER" },
    ],
    tags: [tag("Production"), tag("Certified")],
    glossaryTerms: [term("Commerce.Order")],
    domain: domain("Commerce"),
    schema: [
      { fieldPath: "order_id", nativeDataType: "varchar", nullable: false, description: "Surrogate key." },
      { fieldPath: "customer_id", nativeDataType: "varchar", nullable: false },
      { fieldPath: "order_status", nativeDataType: "varchar", nullable: false, description: "placed | shipped | delivered | refunded | cancelled" },
      { fieldPath: "gross_amount_usd", nativeDataType: "numeric(18,2)", nullable: false, description: "Order total in USD, before refunds." },
      { fieldPath: "net_amount_usd", nativeDataType: "numeric(18,2)", nullable: false, description: "Gross minus refunds. Use this for revenue." },
      { fieldPath: "placed_at", nativeDataType: "timestamp", nullable: false },
    ],
    profile: { timestampMillis: NOW - 3 * HOUR, rowCount: 47_902_338, columnCount: 6 },
    usage: { windowDays: 30, totalSqlQueries: 61, uniqueUserCount: 3, topUsers: [user("maya.rodriguez"), user("finance.analytics"), user("svc.dbt")] },
    operation: { lastUpdatedTimestamp: NOW - 3 * HOUR, operationType: "INSERT" },
    upstreams: [{ dataset: ORDERS_STG, type: "TRANSFORMED" }],
    siblings: [ORDERS_SF],
    siblingPrimary: true,
    assertions: [
      { urn: "urn:li:assertion:fct-orders-freshness", type: "FRESHNESS", description: "fct_orders built within the last 6 hours", lastResult: "SUCCESS" },
      { urn: "urn:li:assertion:fct-orders-unique", type: "COLUMN", description: "order_id is unique and not null", lastResult: "SUCCESS" },
      { urn: "urn:li:assertion:fct-orders-volume", type: "VOLUME", description: "row count within 5% of 7-day average", lastResult: "SUCCESS" },
    ],
  },
  {
    urn: ORDERS_SF,
    platform: "snowflake",
    name: "ANALYTICS.MARTS.FCT_ORDERS",
    qualifiedName: "ANALYTICS.MARTS.FCT_ORDERS",
    subType: "Table",
    description: "Order grain fact table. One row per order, refunds netted, currency normalised to USD.",
    descriptionIsCurated: false,
    owners: [{ owner: user("maya.rodriguez"), type: "TECHNICAL_OWNER" }],
    tags: [tag("Production"), tag("Certified")],
    glossaryTerms: [term("Commerce.Order")],
    domain: domain("Commerce"),
    schema: [
      { fieldPath: "ORDER_ID", nativeDataType: "VARCHAR", nullable: false },
      { fieldPath: "CUSTOMER_ID", nativeDataType: "VARCHAR", nullable: false },
      { fieldPath: "ORDER_STATUS", nativeDataType: "VARCHAR", nullable: false },
      { fieldPath: "GROSS_AMOUNT_USD", nativeDataType: "NUMBER(18,2)", nullable: false },
      { fieldPath: "NET_AMOUNT_USD", nativeDataType: "NUMBER(18,2)", nullable: false },
      { fieldPath: "PLACED_AT", nativeDataType: "TIMESTAMP_NTZ", nullable: false },
    ],
    profile: { timestampMillis: NOW - 3 * HOUR, rowCount: 47_902_338, columnCount: 6 },
    // Built two months ago; adoption never happened. Most people still query the
    // staging copy they already had a saved query for. This is the ordinary shape
    // of a real catalog, and it is exactly why "most queried" misleads.
    usage: { windowDays: 30, totalSqlQueries: 96, uniqueUserCount: 3, topUsers: [user("bi.looker"), user("finance.analytics"), user("svc.dbt")] },
    operation: { lastUpdatedTimestamp: NOW - 3 * HOUR, operationType: "INSERT" },
    upstreams: [{ dataset: ORDERS_DBT, type: "TRANSFORMED" }],
    siblings: [ORDERS_DBT],
    siblingPrimary: false,
    assertions: [],
  },
  {
    urn: ORDERS_LEGACY,
    platform: "bigquery",
    name: "legacy_dw.reporting.orders_snapshot_2024",
    qualifiedName: "legacy_dw.reporting.orders_snapshot_2024",
    subType: "Snapshot",
    description: "Frozen 2024 reporting snapshot. Kept for the FY24 board deck.",
    descriptionIsCurated: true,
    owners: [{ owner: user("tom.becker"), type: "TECHNICAL_OWNER" }],
    tags: [tag("Deprecated")],
    glossaryTerms: [],
    domain: domain("Commerce"),
    schema: [
      { fieldPath: "order_id", nativeDataType: "STRING", nullable: false },
      { fieldPath: "customer_id", nativeDataType: "STRING", nullable: false },
      { fieldPath: "amount", nativeDataType: "FLOAT64", nullable: true, description: "Order total. Currency depends on the storefront; not normalised." },
      { fieldPath: "order_date", nativeDataType: "DATE", nullable: false },
    ],
    deprecation: {
      deprecated: true,
      note: "Frozen at 2024-12-31. Do not use for current reporting.",
      decommissionTime: Date.parse("2026-12-31T00:00:00Z"),
      actor: user("tom.becker"),
    },
    profile: { timestampMillis: Date.parse("2024-12-31T23:00:00Z"), rowCount: 31_004_552, columnCount: 4 },
    usage: { windowDays: 30, totalSqlQueries: 88, uniqueUserCount: 1, topUsers: [user("bi.looker")] },
    operation: { lastUpdatedTimestamp: Date.parse("2024-12-31T23:00:00Z"), operationType: "INSERT" },
    upstreams: [],
    assertions: [],
  },
  {
    urn: ORDERS_EXPLORE,
    platform: "looker",
    name: "orders_explore",
    qualifiedName: "ecommerce_model.orders_explore",
    subType: "Explore",
    description: "Looker explore for self-serve order analysis.",
    descriptionIsCurated: true,
    owners: [{ owner: user("bi.team"), type: "TECHNICAL_OWNER" }],
    tags: [],
    glossaryTerms: [],
    domain: domain("Commerce"),
    schema: [],
    usage: { windowDays: 30, totalSqlQueries: 730, uniqueUserCount: 24, topUsers: [user("bi.looker")] },
    upstreams: [{ dataset: ORDERS_LEGACY, type: "VIEW" }],
    assertions: [],
  },

  // Revenue: two marts, two owners, no adjudicable winner.
  {
    urn: REV_FINANCE,
    platform: "snowflake",
    name: "ANALYTICS.FINANCE.REVENUE_DAILY",
    qualifiedName: "ANALYTICS.FINANCE.REVENUE_DAILY",
    subType: "Table",
    description: "Daily recognised revenue, finance definition: net of refunds, excludes shipping, booked on delivery date.",
    descriptionIsCurated: true,
    owners: [{ owner: user("finance.analytics"), type: "BUSINESS_OWNER" }],
    tags: [tag("Production"), tag("Certified")],
    glossaryTerms: [term("Finance.Revenue")],
    domain: domain("Finance"),
    schema: [
      { fieldPath: "revenue_date", nativeDataType: "DATE", nullable: false },
      { fieldPath: "recognised_revenue_usd", nativeDataType: "NUMBER(18,2)", nullable: false },
    ],
    profile: { timestampMillis: NOW - 5 * HOUR, rowCount: 1_461, columnCount: 2 },
    usage: { windowDays: 30, totalSqlQueries: 902, uniqueUserCount: 9, topUsers: [user("finance.analytics"), user("bi.looker")] },
    operation: { lastUpdatedTimestamp: NOW - 5 * HOUR, operationType: "INSERT" },
    upstreams: [{ dataset: ORDERS_SF, type: "TRANSFORMED" }],
    assertions: [{ urn: "urn:li:assertion:rev-daily-freshness", type: "FRESHNESS", description: "loaded daily by 06:00 UTC", lastResult: "SUCCESS" }],
  },
  {
    urn: REV_GROWTH,
    platform: "bigquery",
    name: "growth_analytics.metrics.daily_revenue",
    qualifiedName: "growth_analytics.metrics.daily_revenue",
    subType: "Table",
    description: "Daily revenue, growth definition: gross bookings including shipping, booked on order date. Used in the weekly growth review.",
    descriptionIsCurated: true,
    owners: [{ owner: user("priya.n"), type: "BUSINESS_OWNER" }],
    tags: [tag("Production")],
    glossaryTerms: [term("Finance.Revenue")],
    domain: domain("Growth"),
    schema: [
      { fieldPath: "dt", nativeDataType: "DATE", nullable: false },
      { fieldPath: "gross_bookings_usd", nativeDataType: "NUMERIC", nullable: false },
    ],
    profile: { timestampMillis: NOW - 6 * HOUR, rowCount: 1_461, columnCount: 2 },
    usage: { windowDays: 30, totalSqlQueries: 874, uniqueUserCount: 8, topUsers: [user("priya.n"), user("growth.team")] },
    operation: { lastUpdatedTimestamp: NOW - 6 * HOUR, operationType: "INSERT" },
    upstreams: [{ dataset: ORDERS_SF, type: "TRANSFORMED" }],
    assertions: [{ urn: "urn:li:assertion:daily-rev-freshness", type: "FRESHNESS", description: "loaded daily by 07:00 UTC", lastResult: "SUCCESS" }],
  },

  // Customer contact: the governance trap.
  {
    urn: CUST_RAW,
    platform: "postgres",
    name: "ecommerce_prod.public.customers",
    qualifiedName: "ecommerce_prod.public.customers",
    subType: "Table",
    description: "Application customer table.",
    descriptionIsCurated: true,
    owners: [{ owner: user("dev.platform"), type: "TECHNICAL_OWNER" }],
    tags: [tag("Production"), tag("PII")],
    glossaryTerms: [term("PII.Personal")],
    domain: domain("Commerce"),
    schema: [
      { fieldPath: "id", nativeDataType: "bigint", nullable: false },
      { fieldPath: "email", nativeDataType: "varchar(255)", nullable: false, glossaryTerms: [term("PII.Email")] },
      { fieldPath: "full_name", nativeDataType: "varchar(255)", nullable: true, glossaryTerms: [term("PII.Name")] },
      { fieldPath: "created_at", nativeDataType: "timestamptz", nullable: false },
    ],
    profile: { timestampMillis: NOW - HOUR, rowCount: 8_004_119, columnCount: 4 },
    usage: { windowDays: 30, totalSqlQueries: 640_221, uniqueUserCount: 2, topUsers: [user("svc.fivetran"), user("svc.checkout")] },
    operation: { lastUpdatedTimestamp: NOW - 2 * 60_000, operationType: "UPDATE" },
    upstreams: [],
    assertions: [],
  },
  {
    urn: CUST_MARKETING,
    platform: "snowflake",
    name: "ANALYTICS.MARTS.DIM_CUSTOMER_CONTACTABLE",
    qualifiedName: "ANALYTICS.MARTS.DIM_CUSTOMER_CONTACTABLE",
    subType: "Table",
    description:
      "Customer dimension filtered to marketing-contactable customers: consent granted, not unsubscribed, not in a deletion request. Use this for any outbound campaign.",
    descriptionIsCurated: true,
    owners: [
      { owner: user("maya.rodriguez"), type: "TECHNICAL_OWNER" },
      { owner: user("legal.privacy"), type: "BUSINESS_OWNER" },
    ],
    tags: [tag("Production"), tag("Certified"), tag("PII")],
    glossaryTerms: [term("PII.Personal"), term("Governance.ConsentFiltered")],
    domain: domain("Marketing"),
    schema: [
      { fieldPath: "CUSTOMER_ID", nativeDataType: "VARCHAR", nullable: false },
      { fieldPath: "EMAIL", nativeDataType: "VARCHAR", nullable: false, glossaryTerms: [term("PII.Email")] },
      { fieldPath: "CONSENT_GRANTED_AT", nativeDataType: "TIMESTAMP_NTZ", nullable: false },
      { fieldPath: "UNSUBSCRIBED_AT", nativeDataType: "TIMESTAMP_NTZ", nullable: true },
    ],
    profile: { timestampMillis: NOW - 4 * HOUR, rowCount: 5_112_770, columnCount: 4 },
    usage: { windowDays: 30, totalSqlQueries: 143, uniqueUserCount: 3, topUsers: [user("marketing.ops"), user("maya.rodriguez")] },
    operation: { lastUpdatedTimestamp: NOW - 4 * HOUR, operationType: "INSERT" },
    upstreams: [{ dataset: CUST_RAW, type: "TRANSFORMED" }],
    assertions: [{ urn: "urn:li:assertion:contactable-consent", type: "SQL", description: "no rows where CONSENT_GRANTED_AT is null", lastResult: "SUCCESS" }],
  },
  {
    urn: CUST_EXPORT,
    platform: "s3",
    name: "data-exports/adhoc/customer_email_dump_2025_11",
    qualifiedName: "s3://data-exports/adhoc/customer_email_dump_2025_11",
    subType: "Table",
    owners: [],
    tags: [],
    glossaryTerms: [],
    schema: [
      { fieldPath: "email", nativeDataType: "string", nullable: true },
      { fieldPath: "name", nativeDataType: "string", nullable: true },
    ],
    profile: { timestampMillis: Date.parse("2025-11-14T10:00:00Z"), rowCount: 7_880_004, columnCount: 2 },
    usage: { windowDays: 30, totalSqlQueries: 3, uniqueUserCount: 1, topUsers: [user("intern.jess")] },
    operation: { lastUpdatedTimestamp: Date.parse("2025-11-14T10:00:00Z"), operationType: "CREATE" },
    upstreams: [],
    assertions: [],
  },
];

// Recorded queries — the "what do people actually run" signal

const queries: RecordedQuery[] = [
  {
    queryUrn: "urn:li:query:q-analyst-weekly-orders",
    sql: "select date_trunc('day', created_at) d, count(*) n\nfrom ANALYTICS.STAGING.STG_ORDERS\nwhere created_at >= dateadd(day, -7, current_date)\ngroup by 1 order by 1",
    runCount: 61,
    lastRunAt: NOW - 6 * HOUR,
    actors: [user("maya.rodriguez"), user("tom.becker"), user("intern.jess")],
    touches: [ORDERS_STG],
  },
  {
    queryUrn: "urn:li:query:q-finance-net-revenue",
    sql: "select sum(NET_AMOUNT_USD) from ANALYTICS.MARTS.FCT_ORDERS where PLACED_AT >= date_trunc('month', current_date)",
    runCount: 412,
    lastRunAt: NOW - 40 * 60_000,
    actors: [user("finance.analytics"), user("bi.looker")],
    touches: [ORDERS_SF],
  },
  {
    queryUrn: "urn:li:query:q-legacy-board-deck",
    sql: "select order_date, sum(amount) from legacy_dw.reporting.orders_snapshot_2024 group by 1",
    runCount: 4,
    lastRunAt: NOW - 26 * DAY,
    actors: [user("bi.looker")],
    touches: [ORDERS_LEGACY],
  },
  {
    queryUrn: "urn:li:query:q-etl-copy-orders",
    sql: "insert into ANALYTICS.STAGING.STG_ORDERS select * from ecommerce_prod.public.orders where updated_at > ?",
    runCount: 8_400,
    lastRunAt: NOW - 3 * DAY - 2 * HOUR,
    actors: [user("svc.fivetran")],
    touches: [ORDERS_RAW, ORDERS_STG],
  },
  {
    queryUrn: "urn:li:query:q-campaign-list",
    sql: "select EMAIL from ANALYTICS.MARTS.DIM_CUSTOMER_CONTACTABLE where UNSUBSCRIBED_AT is null",
    runCount: 27,
    lastRunAt: NOW - 2 * DAY,
    actors: [user("marketing.ops")],
    touches: [CUST_MARKETING],
  },
  {
    queryUrn: "urn:li:query:q-adhoc-email-pull",
    sql: "select email, full_name from ecommerce_prod.public.customers limit 100000",
    runCount: 2,
    lastRunAt: Date.parse("2025-11-14T09:40:00Z"),
    actors: [user("intern.jess")],
    touches: [CUST_RAW],
  },
];

// Bulk — enough neighbours that search has to work for a living

const BULK_DOMAINS = ["Commerce", "Finance", "Growth", "Marketing", "Supply", "Support", "Product"];
const BULK_SUBJECTS = [
  "sessions", "page_views", "cart_events", "shipments", "returns", "inventory_snapshot",
  "supplier_invoices", "payouts", "campaign_sends", "email_clicks", "support_tickets",
  "product_catalog", "price_changes", "warehouse_stock", "carrier_scans", "refunds",
  "subscriptions", "trials", "coupons", "ab_test_exposures", "app_installs", "push_sends",
  "reviews", "search_queries", "recommendations", "fraud_scores", "chargebacks", "tax_lines",
  "wishlists", "gift_cards", "loyalty_points", "store_visits", "pickup_slots", "delivery_slas",
  "supplier_scorecards", "purchase_orders", "stock_transfers", "cycle_counts", "shrinkage",
  "attribution_touches", "affiliate_clicks", "referral_codes", "churn_scores", "ltv_predictions",
  "basket_affinity", "price_elasticity", "promo_redemptions", "call_transcripts", "nps_responses",
  "warranty_claims", "product_defects", "packaging_specs", "carbon_estimates", "vendor_contracts",
];
const BULK_LAYERS: Array<{ prefix: string; platform: PlatformName; subType: SubType; container: string }> = [
  { prefix: "raw", platform: "postgres", subType: "Table", container: "ecommerce_prod.public" },
  { prefix: "stg", platform: "snowflake", subType: "Table", container: "ANALYTICS.STAGING" },
  { prefix: "int", platform: "dbt", subType: "Table Model", container: "analytics.intermediate" },
  { prefix: "fct", platform: "snowflake", subType: "Table", container: "ANALYTICS.MARTS" },
  { prefix: "vw", platform: "looker", subType: "Explore", container: "ecommerce_model" },
  { prefix: "topic", platform: "kafka", subType: "Topic", container: "prod" },
];

/** Deterministic pseudo-random so regenerating the catalog never churns the diff. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 4_294_967_296;
  };
}

function buildBulk(): DatasetEntity[] {
  const rand = rng(20260802);
  const out: DatasetEntity[] = [];
  for (const subject of BULK_SUBJECTS) {
    for (const layer of BULK_LAYERS) {
      if (rand() < 0.22) continue; // not every subject exists at every layer — that is the point
      const nm =
        layer.platform === "kafka"
          ? `${layer.container}.${subject}`
          : `${layer.container}.${layer.prefix}_${subject}`;
      const urn = ds(layer.platform, nm);
      const staleDays = Math.floor(rand() * 9);
      const hasOwner = rand() > 0.38;
      const hasDesc = rand() > 0.45;
      const dep = rand() > 0.93;
      out.push({
        urn,
        platform: layer.platform,
        name: nm,
        qualifiedName: nm,
        subType: layer.subType,
        description: hasDesc ? `${subject.replace(/_/g, " ")} at the ${layer.prefix} layer.` : undefined,
        descriptionIsCurated: hasDesc && rand() > 0.5,
        owners: hasOwner
          ? [{ owner: user(["maya.rodriguez", "tom.becker", "priya.n", "dev.platform", "bi.team"][Math.floor(rand() * 5)] ?? "dev.platform"), type: "TECHNICAL_OWNER" }]
          : [],
        tags: rand() > 0.7 ? [tag("Production")] : [],
        glossaryTerms: [],
        domain: domain(BULK_DOMAINS[Math.floor(rand() * BULK_DOMAINS.length)] ?? "Commerce"),
        schema: [
          { fieldPath: "id", nativeDataType: "varchar", nullable: false },
          { fieldPath: "created_at", nativeDataType: "timestamp", nullable: false },
          { fieldPath: "value", nativeDataType: "numeric", nullable: true },
        ],
        deprecation: dep ? { deprecated: true, note: "Superseded during the 2025 warehouse migration." } : undefined,
        profile: {
          timestampMillis: NOW - staleDays * DAY,
          rowCount: Math.floor(rand() * 40_000_000) + 1_000,
          columnCount: 3,
        },
        usage: {
          windowDays: 30,
          totalSqlQueries: Math.floor(rand() * 900),
          uniqueUserCount: Math.floor(rand() * 12),
          topUsers: [],
        },
        operation: { lastUpdatedTimestamp: NOW - staleDays * DAY, operationType: "INSERT" },
        upstreams: [],
        assertions: [],
      });
    }
  }
  return out;
}

const entities = [...heroEntities, ...buildBulk()];

const catalog = {
  generatedAt: NOW,
  note:
    "FIXTURE CATALOG. Hand-authored to the shapes DataHub actually returns (see src/datahub/types.ts). " +
    "Not a capture of a live DataHub instance. Regenerate with `npm run build:catalog`.",
  platforms: [...new Set(entities.map((e) => e.platform))].sort(),
  entityCount: entities.length,
  entities,
  queries,
};

mkdirSync(join(ROOT, "fixtures"), { recursive: true });
writeFileSync(join(ROOT, "fixtures", "catalog.json"), JSON.stringify(catalog, null, 2) + "\n");
process.stdout.write(
  `wrote fixtures/catalog.json — ${entities.length} entities across ${catalog.platforms.length} platforms, ${queries.length} recorded queries\n`,
);
