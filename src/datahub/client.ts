// The one mocked seam.
//
// Everything above this line is real product code. Everything below it is either
// a fixture reader (mock) or a DataHub transport (live). Swapping mock -> live is
// changing which implementation this factory returns; no caller changes.

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

export type DataHubClient = {
  readonly mode: "mock" | "live";

  // Read surface
  search(query: string, opts?: { limit?: number }): Promise<SearchResult>;
  getEntities(urns: Urn[]): Promise<DatasetEntity[]>;
  getLineage(urn: Urn, direction: "UPSTREAM" | "DOWNSTREAM", degree?: number): Promise<LineageResult>;
  getDatasetQueries(urn: Urn, opts?: { limit?: number }): Promise<RecordedQuery[]>;

  /**
   * Reads canon's own prior rulings back out of the graph.
   * This is the compounding loop: a resolved question is answered by the catalog,
   * not by the model.
   */
  getCanonRuling(subject: string): Promise<PersistedRuling | null>;

  // Write surface
  applyMutations(mutations: Mutation[]): Promise<MutationReceipt[]>;
  upsertDocument(doc: ContextDocument): Promise<MutationReceipt>;
};

/**
 * What a ruling looks like once it lives in DataHub rather than in canon's memory.
 * Reconstructed from structured properties + the attached Context Document, so a
 * human editing those values in the DataHub UI changes what canon answers next.
 */
export type PersistedRuling = {
  subject: string;
  canonicalUrn: Urn;
  supersededUrns: Urn[];
  decidedAt: number;
  decidedBy: string;
  documentUrn?: Urn;
  rationale: string;
};

/**
 * Shuts down anything the client is holding open. The live client owns MCP
 * server child processes, and those keep the node event loop alive, so every
 * entry point calls this before it finishes.
 */
export async function closeClient(client: DataHubClient): Promise<void> {
  const maybe = client as { close?: () => Promise<void> };
  if (typeof maybe.close !== "function") return;
  // The MCP SDK's close() does not always settle once a server process has been
  // retired, so shutdown is bounded rather than awaited indefinitely. Callers
  // exit after this; the child processes are killed with the parent either way.
  await Promise.race([maybe.close(), new Promise((r) => setTimeout(r, 3000))]);
}

export type ClientOptions = {
  fixturePath?: string;
  gmsUrl?: string;
  token?: string;
};

/**
 * Picks the implementation. Default is mock so that `npm run demo` works on a
 * clean checkout with no credentials of any kind. See SWAP-TO-LIVE.md.
 */
export async function createClient(options: ClientOptions = {}): Promise<DataHubClient> {
  const wantsLive = process.env.CANON_MODE === "live";
  if (!wantsLive) {
    const { MockDataHubClient } = await import("./mock.ts");
    return MockDataHubClient.load(options.fixturePath);
  }
  const gmsUrl = options.gmsUrl ?? process.env.DATAHUB_GMS_URL;
  if (!gmsUrl) {
    throw new Error("CANON_MODE=live requires DATAHUB_GMS_URL. See .env.example / RUNNING-LIVE.md.");
  }
  // A token is optional: `datahub docker quickstart` ships with metadata service
  // auth disabled, so a local instance needs none. Any hardened deployment does.
  const token = options.token ?? process.env.DATAHUB_GMS_TOKEN;
  const { LiveDataHubClient } = await import("./live.ts");
  return new LiveDataHubClient(gmsUrl, token);
}
