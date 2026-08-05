// Live DataHub client — STUB, NOT YET EXERCISED AGAINST A RUNNING INSTANCE.
//
// Honesty statement, because this matters more than the code:
// every query below is written against DataHub's documented GraphQL surface and
// its documented aspect names, but this file has NEVER been run against a live
// DataHub. No fixture in this repo was captured from it. Treat every operation
// as UNVERIFIED until the checklist in SWAP-TO-LIVE.md has been walked.
//
// The interface is the contract, so the swap is wiring, not a refactor: whatever
// is wrong here is wrong inside these method bodies and nowhere else.

import type { DataHubClient, PersistedRuling } from "./client.ts";
import {
  CANON_DECIDED_AT_PROP,
  CANON_RATIONALE_PROP,
  CANON_STATUS_PROP,
  CANON_SUBJECT_PROP,
  CANON_SUPERSEDED_BY_PROP,
} from "./mock.ts";
import type {
  ContextDocument,
  DatasetEntity,
  LineageResult,
  Mutation,
  MutationReceipt,
  RecordedQuery,
  SearchResult,
  Urn,
} from "./types.ts";

/** Marks an operation that has never been run against a live DataHub. */
const UNVERIFIED = "UNVERIFIED against a live DataHub instance";

export class LiveDataHubClient implements DataHubClient {
  readonly mode = "live" as const;

  private readonly gmsUrl: string;
  private readonly token: string;

  constructor(gmsUrl: string, token: string) {
    this.gmsUrl = gmsUrl;
    this.token = token;
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.gmsUrl.replace(/\/$/, "")}/api/graphql`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      throw new Error(`DataHub GraphQL ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (body.errors?.length) {
      throw new Error(`DataHub GraphQL errors: ${body.errors.map((e) => e.message).join("; ")}`);
    }
    if (!body.data) throw new Error("DataHub GraphQL returned no data");
    return body.data;
  }

  // Read surface

  async search(query: string, opts: { limit?: number } = {}): Promise<SearchResult> {
    type Resp = {
      searchAcrossEntities: {
        total: number;
        searchResults: Array<{
          entity: { urn: string; type: string; properties?: { name?: string } | null };
          score?: number | null;
        }>;
      };
    };
    const data = await this.graphql<Resp>(
      `query canonSearch($q: String!, $count: Int!) {
        searchAcrossEntities(input: {types: [DATASET], query: $q, start: 0, count: $count}) {
          total
          searchResults { entity { urn type ... on Dataset { properties { name } } } }
        }
      }`,
      { q: query, count: opts.limit ?? 20 },
    );
    const hits = data.searchAcrossEntities.searchResults.map((r, i) => ({
      urn: r.entity.urn,
      name: r.entity.properties?.name ?? r.entity.urn,
      platform: platformOf(r.entity.urn),
      subType: "Table" as const,
      // GraphQL does not return a relevance score on this shape; rank order is
      // the signal, so the baseline uses position rather than a fabricated score.
      score: Math.max(0, 100 - i),
    }));
    return { query, total: data.searchAcrossEntities.total, hits };
  }

  async getEntities(_urns: Urn[]): Promise<DatasetEntity[]> {
    throw new Error(
      `getEntities is ${UNVERIFIED}. Implement against the Dataset GraphQL fragment ` +
        `(schemaMetadata, ownership, globalTags, glossaryTerms, deprecation, datasetProfiles, ` +
        `usageStats, siblings, subTypes, structuredProperties) — see SWAP-TO-LIVE.md step 4.`,
    );
  }

  async getLineage(_urn: Urn, _direction: "UPSTREAM" | "DOWNSTREAM", _degree = 3): Promise<LineageResult> {
    throw new Error(
      `getLineage is ${UNVERIFIED}. Implement with searchAcrossLineage (input: {urn, direction, ` +
        `count}) — see SWAP-TO-LIVE.md step 4.`,
    );
  }

  async getDatasetQueries(_urn: Urn, _opts: { limit?: number } = {}): Promise<RecordedQuery[]> {
    throw new Error(
      `getDatasetQueries is ${UNVERIFIED}. The MCP server exposes get_dataset_queries; the GraphQL ` +
        `equivalent is the Query entity related to the dataset — see SWAP-TO-LIVE.md step 4.`,
    );
  }

  async getCanonRuling(_subject: string): Promise<PersistedRuling | null> {
    throw new Error(
      `getCanonRuling is ${UNVERIFIED}. Implement as a structured-property filtered search over ` +
        `${CANON_STATUS_PROP} = "canonical" and ${CANON_SUBJECT_PROP} = subject, then read ` +
        `${CANON_SUPERSEDED_BY_PROP}, ${CANON_DECIDED_AT_PROP} and ${CANON_RATIONALE_PROP} off the ` +
        `matching entities — see SWAP-TO-LIVE.md step 5.`,
    );
  }

  // Write surface

  async applyMutations(_mutations: Mutation[]): Promise<MutationReceipt[]> {
    throw new Error(
      `applyMutations is ${UNVERIFIED}. Route each mutation through the MCP server with ` +
        `TOOLS_IS_MUTATION_ENABLED=true, or the GraphQL mutations updateDeprecation / addTags / ` +
        `addTerms / upsertStructuredProperties — see SWAP-TO-LIVE.md step 6.`,
    );
  }

  async upsertDocument(_doc: ContextDocument): Promise<MutationReceipt> {
    throw new Error(
      `upsertDocument is ${UNVERIFIED}. Write the ruling as a DataHub Document / institutionalMemory ` +
        `link attached to the ruled entities — see SWAP-TO-LIVE.md step 6.`,
    );
  }
}

function platformOf(urn: string): DatasetEntity["platform"] {
  const m = /dataPlatform:([^,)]+)/.exec(urn);
  return (m?.[1] ?? "snowflake") as DatasetEntity["platform"];
}
