// DataHub payload shapes.
//
// Provenance: these mirror the aspect names and field names DataHub actually uses
// (datasetProperties, schemaMetadata, ownership, globalTags, glossaryTerms,
// deprecation, datasetProfile, datasetUsageStatistics, siblings, upstreamLineage,
// structuredProperties, subTypes, operation). They are deliberately a SUBSET —
// only the fields canon reads or writes — so the live client can populate them
// from GraphQL / the MCP server without reshaping anything downstream.
//
// The read/write surface and where each field comes from: RUNNING-LIVE.md.

export type Urn = string;

export type PlatformName =
  | "postgres"
  | "snowflake"
  | "bigquery"
  | "dbt"
  | "looker"
  | "tableau"
  | "kafka"
  | "s3"
  | "airflow";

/** DataHub `subTypes.typeNames[0]` — what kind of thing this actually is. */
export type SubType =
  | "Table"
  | "View"
  | "Incremental Model"
  | "Table Model"
  | "Source"
  | "Snapshot"
  | "Topic"
  | "Explore"
  | "Dashboard"
  | "Chart";

export type OwnershipType = "TECHNICAL_OWNER" | "BUSINESS_OWNER" | "DATAOWNER" | "NONE";

export type Owner = {
  owner: Urn;
  type: OwnershipType;
};

export type SchemaField = {
  fieldPath: string;
  nativeDataType: string;
  nullable: boolean;
  description?: string;
  /** Term URNs applied at the column level — how PII shows up in a real catalog. */
  glossaryTerms?: Urn[];
  tags?: Urn[];
};

export type Deprecation = {
  deprecated: boolean;
  note?: string;
  decommissionTime?: number;
  actor?: Urn;
};

/** DataHub `datasetProfile` — the physical shape at a point in time. */
export type DatasetProfile = {
  timestampMillis: number;
  rowCount: number;
  columnCount: number;
};

/** DataHub `datasetUsageStatistics` — who actually queries this thing. */
export type UsageStats = {
  /** Window the counts cover, in days. */
  windowDays: number;
  totalSqlQueries: number;
  uniqueUserCount: number;
  /** Corpuser URNs, most active first. */
  topUsers: Urn[];
};

/** DataHub `operation.lastUpdatedTimestamp` — the freshness signal. */
export type OperationInfo = {
  lastUpdatedTimestamp: number;
  operationType?: "INSERT" | "UPDATE" | "CREATE" | "ALTER";
};

export type UpstreamEdge = {
  dataset: Urn;
  type: "TRANSFORMED" | "COPY" | "VIEW";
};

export type StructuredPropertyValue = {
  propertyUrn: Urn;
  values: Array<string | number>;
};

export type AssertionSummary = {
  urn: Urn;
  type: "FRESHNESS" | "VOLUME" | "COLUMN" | "SQL";
  description: string;
  lastResult: "SUCCESS" | "FAILURE" | "ERROR" | "INIT";
};

/**
 * One catalog entity as canon sees it. Flattened from the aspects above:
 * the mock builds this from fixtures, the live client from a GraphQL fragment.
 */
export type DatasetEntity = {
  urn: Urn;
  platform: PlatformName;
  /** The platform-native identifier, e.g. `ANALYTICS.MARTS.FCT_ORDERS`. */
  name: string;
  qualifiedName: string;
  subType: SubType;
  description?: string;
  /** True when the description came from `editableDatasetProperties` (a human wrote it). */
  descriptionIsCurated?: boolean;
  owners: Owner[];
  tags: Urn[];
  glossaryTerms: Urn[];
  domain?: Urn;
  container?: Urn;
  schema: SchemaField[];
  deprecation?: Deprecation;
  profile?: DatasetProfile;
  usage?: UsageStats;
  operation?: OperationInfo;
  upstreams: UpstreamEdge[];
  /** DataHub siblings — the dbt model and its warehouse materialization are one asset. */
  siblings?: Urn[];
  siblingPrimary?: boolean;
  assertions?: AssertionSummary[];
  structuredProperties?: StructuredPropertyValue[];
};

export type SearchHit = {
  urn: Urn;
  name: string;
  platform: PlatformName;
  subType: SubType;
  /** DataHub's own relevance score for the query. */
  score: number;
};

export type SearchResult = {
  query: string;
  total: number;
  hits: SearchHit[];
};

export type LineagePathNode = {
  urn: Urn;
  hop: number;
};

export type LineageResult = {
  urn: Urn;
  direction: "UPSTREAM" | "DOWNSTREAM";
  degree: number;
  nodes: LineagePathNode[];
};

/** Shape returned by the MCP `get_dataset_queries` tool. */
export type RecordedQuery = {
  queryUrn: Urn;
  sql: string;
  runCount: number;
  lastRunAt: number;
  actors: Urn[];
  /** URNs of datasets this query touches. */
  touches: Urn[];
};

// Write surface

/** A DataHub Document (Context Document) — the artifact the next agent inherits. */
export type ContextDocument = {
  urn?: Urn;
  title: string;
  contents: string;
  /** Entities this document is attached to. */
  relatedEntities: Urn[];
};

export type Mutation =
  | { kind: "setStructuredProperty"; entity: Urn; propertyUrn: Urn; values: Array<string | number> }
  /**
   * Retraction. If canon ruled on a subject once and now abstains — because the
   * catalog changed under it, or a second definition appeared — leaving the old
   * `canon.status = canonical` in place would be worse than never having ruled:
   * every reader downstream would keep acting on a claim canon no longer stands
   * behind. Abstaining has to be able to take a claim back.
   */
  | { kind: "removeStructuredProperty"; entity: Urn; propertyUrns: Urn[] }
  | { kind: "setDeprecation"; entity: Urn; deprecated: boolean; note: string }
  | { kind: "addGlossaryTerm"; entity: Urn; term: Urn }
  | { kind: "addTag"; entity: Urn; tag: Urn }
  | { kind: "upsertDocument"; document: ContextDocument }
  /**
   * The ABSTAIN branch. In live mode this becomes a native DataHub Incident
   * assigned to `assignees` — the owners canon read off the candidates — so the
   * unanswerable question lands inside the catalog rather than in a message
   * nobody can audit later.
   */
  | { kind: "createProposal"; entity: Urn; title: string; body: string; assignees?: Urn[] };

export type MutationReceipt = {
  mutation: Mutation;
  applied: boolean;
  /**
   * The transport that actually carried this write, on whichever path ran.
   *
   * Live: `mcp:add_structured_properties`, `mcp:save_document`,
   * `python-sdk:deprecation`, `python-sdk:incidentInfo`.
   * Fixture: `fixture:structuredProperty (live -> mcp:add_structured_properties)`
   * and friends — what happened, and what would have happened live.
   *
   * This field used to say "the MCP tool name" while only the mock ever set it,
   * and the mock named tools that do not exist in DataHub OSS. It is rendered
   * into the judge-facing report, so it has to be true on both paths.
   */
  via: string;
  at: number;
  error?: string;
};
