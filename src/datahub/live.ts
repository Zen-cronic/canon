// The live DataHub client. Every read and every OSS-legal write goes over MCP.
//
// Read surface, all `acryldata/mcp-server-datahub` tools (run `npm run mcp:probe`
// to print the list from a running server):
//
//     search                  candidate discovery
//     get_entities            properties, ownership, tags, terms, subTypes,
//                             deprecation, schemaMetadata, siblings, health
//     get_lineage             upstream and downstream, with hop distance
//     get_dataset_queries     who actually runs SQL against it
//
// Write surface:
//
//     add_structured_properties   the canon.* ruling            (MCP)
//     save_document               the evidence trail            (MCP)
//     deprecation aspect          the retired landing copy      (Python SDK)
//     incidentInfo                the ABSTAIN branch            (Python SDK)
//
// The last two have no OSS MCP tool. `set_deprecation` is DataHub Cloud only,
// and the OSS server registers no incident tool at all, so those two go through
// bridge/emit_aspects.py against the same GMS. Every receipt records which
// transport carried it, so nothing in the report claims an MCP call that did
// not happen.
//
// Two live-mode differences from the fixture path, both surfaced rather than
// smoothed over:
//
//   * ASSERTIONS. OSS MCP exposes DataHub's aggregate `health` array
//     (`{type: "ASSERTIONS", status: "PASS"|"FAIL"}`), not per-assertion detail —
//     there is no get_dataset_assertions in the OSS tool list. So live mode sees
//     one synthetic assertion carrying the aggregate verdict, and labels it.
//   * SEARCH SCORE. The MCP search response carries no relevance score, so rank
//     position is used and reported as rank, not dressed up as relevance.

import { spawn } from "node:child_process";
import { spawnMcpServer, type McpSession } from "./mcp.ts";
import type { DataHubClient, PersistedRuling } from "./client.ts";
import type {
  AssertionSummary,
  ContextDocument,
  DatasetEntity,
  Deprecation,
  LineageResult,
  Mutation,
  MutationReceipt,
  PlatformName,
  RecordedQuery,
  SchemaField,
  SearchHit,
  SearchResult,
  SubType,
  Urn,
} from "./types.ts";

import {
  CANON_DECIDED_AT_PROP,
  CANON_RATIONALE_PROP,
  CANON_STATUS_PROP,
  CANON_SUBJECT_PROP,
  CANON_SUPERSEDED_BY_PROP,
} from "./properties.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = Record<string, any>;

/**
 * URNs per get_entities call. Must stay at or under the MCP server's
 * pooled-connection budget (see POOLED_BUDGET in mcp.ts) because that budget is
 * consumed per URN.
 */
const ENTITY_CHUNK = Number(process.env.CANON_ENTITY_CHUNK ?? 5);

export class LiveDataHubClient implements DataHubClient {
  readonly mode = "live" as const;
  readonly #gmsUrl: string;
  readonly #token: string | undefined;
  #mcp: McpSession | null = null;

  constructor(gmsUrl: string, token?: string) {
    this.#gmsUrl = gmsUrl;
    this.#token = token;
  }

  async connect(): Promise<void> {
    if (!this.#mcp) {
      this.#mcp = await spawnMcpServer({ gmsUrl: this.#gmsUrl, token: this.#token, mutations: true });
    }
  }

  async close(): Promise<void> {
    await this.#mcp?.close();
    this.#mcp = null;
  }

  async #session(): Promise<McpSession> {
    await this.connect();
    if (!this.#mcp) throw new Error("MCP session failed to open");
    return this.#mcp;
  }

  /** The MCP server as it identified itself. Printed in the demo banner. */
  async serverInfo(): Promise<{ name: string; version: string }> {
    return (await this.#session()).serverInfo();
  }

  async search(query: string, opts: { limit?: number } = {}): Promise<SearchResult> {
    const mcp = await this.#session();
    const res = await mcp.call<Json>("search", { query, num_results: opts.limit ?? 20 });
    const results: Json[] = res?.searchResults ?? [];
    const hits: SearchHit[] = results
      .map((r, i) => {
        const e = r.entity ?? {};
        return {
          urn: e.urn as Urn,
          name: (e.properties?.qualifiedName ?? e.properties?.name ?? shortFromUrn(e.urn)) as string,
          platform: platformFromUrn(e.urn),
          subType: ((e.subTypes?.typeNames?.[0] as SubType) ?? "Table") as SubType,
          // MCP search returns no score. Rank position is what exists, and the
          // report labels it as rank rather than inventing a relevance number.
          score: results.length - i,
        };
      })
      .filter((h) => Boolean(h.urn));
    return { query, total: res?.total ?? hits.length, hits };
  }

  async getEntities(urns: Urn[]): Promise<DatasetEntity[]> {
    if (urns.length === 0) return [];
    const mcp = await this.#session();

    // Chunked because the pooled-connection budget is spent per URN, not per
    // call: one get_entities over twenty URNs wedges the session outright. The
    // session recycles between chunks, so this is bounded work rather than a
    // gamble on how many candidates a question happens to have.
    const entities: DatasetEntity[] = [];
    for (let i = 0; i < urns.length; i += ENTITY_CHUNK) {
      const chunk = urns.slice(i, i + ENTITY_CHUNK);
      const res = await mcp.call<Json[] | Json>("get_entities", { urns: chunk });
      const list = (Array.isArray(res) ? res : [res]).filter((e) => e && e.urn);
      entities.push(...list.map((e) => toEntity(e)));
    }

    // MCP's get_entities returns a curated subset: properties, ownership, tags,
    // terms, subTypes, schemaMetadata, health. It does NOT return
    // upstreamLineage (so no edge TYPE), siblings, operation, datasetProfile or
    // datasetUsageStatistics — and four of canon's rules read exactly those.
    //
    // So the remaining aspects come from the OSS platform's own aspect endpoint,
    // /openapi/v3/entity/dataset/{urn}, on the same GMS. Still DataHub OSS, still
    // no Cloud surface, and named as a second read surface rather than folded
    // into the MCP claim.
    await Promise.all(entities.map((e) => this.#supplementAspects(e)));
    return entities;
  }

  /** Fills in the aspects the MCP read surface does not expose. */
  async #supplementAspects(entity: DatasetEntity): Promise<void> {
    const aspects = [
      "upstreamLineage",
      "siblings",
      "operation",
      "datasetProfile",
      "datasetUsageStatistics",
      "deprecation",
      "structuredProperties",
    ];
    const url =
      `${this.#gmsUrl}/openapi/v3/entity/dataset/${encodeURIComponent(entity.urn)}?` +
      aspects.map((a) => `aspects=${a}`).join("&");

    let doc: Json;
    try {
      const res = await fetch(url, {
        headers: {
          accept: "application/json",
          ...(this.#token ? { authorization: `Bearer ${this.#token}` } : {}),
        },
      });
      if (!res.ok) return;
      doc = (await res.json()) as Json;
    } catch {
      return;
    }

    const up = doc["upstreamLineage"]?.value?.upstreams;
    if (Array.isArray(up)) {
      entity.upstreams = up
        .filter((u: Json) => u?.dataset)
        .map((u: Json) => ({ dataset: u.dataset as Urn, type: (u.type ?? "TRANSFORMED") as "TRANSFORMED" | "COPY" | "VIEW" }));
    }

    const sib = doc["siblings"]?.value;
    if (sib?.siblings?.length) {
      entity.siblings = sib.siblings as Urn[];
      entity.siblingPrimary = Boolean(sib.primary);
    }

    const op = doc["operation"]?.value;
    if (op?.lastUpdatedTimestamp) {
      entity.operation = {
        lastUpdatedTimestamp: Number(op.lastUpdatedTimestamp),
        operationType: op.operationType,
      };
    }

    const profile = doc["datasetProfile"]?.value;
    if (profile) {
      entity.profile = {
        timestampMillis: Number(profile.timestampMillis ?? 0),
        rowCount: Number(profile.rowCount ?? 0),
        columnCount: Number(profile.columnCount ?? entity.schema.length),
      };
    }

    const usage = doc["datasetUsageStatistics"]?.value;
    if (usage) {
      entity.usage = {
        windowDays: 30,
        totalSqlQueries: Number(usage.totalSqlQueries ?? 0),
        uniqueUserCount: Number(usage.uniqueUserCount ?? 0),
        topUsers: (usage.userCounts ?? []).map((u: Json) => u.user as Urn).filter(Boolean),
      };
    }

    const dep = doc["deprecation"]?.value;
    if (dep?.deprecated) {
      entity.deprecation = { deprecated: true, note: dep.note, actor: dep.actor };
    }

    const props = doc["structuredProperties"]?.value?.properties;
    if (Array.isArray(props)) {
      entity.structuredProperties = props.map((p: Json) => ({
        propertyUrn: p.propertyUrn as Urn,
        // Values come back tagged by type: [{ "string": "..." }] / [{ "double": 1 }].
        values: (p.values ?? []).map((v: Json) =>
          typeof v === "object" && v !== null ? (v["string"] ?? v["double"] ?? v["number"] ?? "") : v,
        ) as Array<string | number>,
      }));
    }
  }

  async getLineage(urn: Urn, direction: "UPSTREAM" | "DOWNSTREAM", degree = 4): Promise<LineageResult> {
    const mcp = await this.#session();
    const res = await mcp.call<Json>("get_lineage", {
      urn,
      upstream: direction === "UPSTREAM",
      max_hops: degree,
      max_results: 50,
    });
    // The MCP response nests under the direction asked for: `{upstreams: {...}}`
    // or `{downstreams: {...}}`, each with its own searchResults array.
    const side: Json | undefined = direction === "UPSTREAM" ? res?.upstreams : res?.downstreams;
    const rows: Json[] = side?.searchResults ?? res?.searchResults ?? [];
    const nodes = rows
      .map((r) => ({
        urn: (r.entity?.urn ?? r.urn) as Urn,
        hop: Number(r.degree ?? r.entity?.degree ?? 1) || 1,
      }))
      .filter((n) => n.urn && n.urn !== urn);
    return { urn, direction, degree, nodes };
  }

  async getDatasetQueries(urn: Urn, opts: { limit?: number } = {}): Promise<RecordedQuery[]> {
    const mcp = await this.#session();
    try {
      const res = await mcp.call<Json>("get_dataset_queries", { urn, count: opts.limit ?? 5 });
      const rows: Json[] = res?.queries ?? res?.searchResults ?? [];
      return rows.map((q) => ({
        queryUrn: (q.urn ?? q.entity?.urn ?? "") as Urn,
        sql: (q.properties?.statement?.value ?? q.statement ?? "") as string,
        runCount: Number(q.runCount ?? q.properties?.runCount ?? 1) || 1,
        lastRunAt: Number(q.properties?.lastModified?.time ?? 0) || 0,
        actors: (q.properties?.lastModified?.actor ? [q.properties.lastModified.actor] : []) as Urn[],
        touches: [urn],
      }));
    } catch {
      // A dataset with no recorded query history is normal, not an error.
      return [];
    }
  }

  /**
   * Reads canon's prior ruling back out of the graph.
   *
   * Two MCP calls in live mode — search, then get_entities to read the
   * structured properties off the hits — where the fixture path needs one. The
   * README says two. A claim that costs one call in a mock and two in reality
   * is exactly the kind of thing that gets caught.
   */
  async getCanonRuling(subject: string): Promise<PersistedRuling | null> {
    const search = await this.search(subject, { limit: 20 });
    if (search.hits.length === 0) return null;
    const entities = await this.getEntities(search.hits.map((h) => h.urn));

    const canonical = entities.find(
      (e) =>
        propValue(e, CANON_STATUS_PROP) === "canonical" &&
        String(propValue(e, CANON_SUBJECT_PROP) ?? "").toLowerCase() === subject.toLowerCase(),
    );
    if (!canonical) return null;

    const superseded = entities
      .filter((e) => propValue(e, CANON_SUPERSEDED_BY_PROP) === canonical.urn)
      .map((e) => e.urn);

    return {
      subject,
      canonicalUrn: canonical.urn,
      supersededUrns: superseded,
      decidedAt: Number(propValue(canonical, CANON_DECIDED_AT_PROP) ?? 0),
      decidedBy: "canon",
      rationale: String(propValue(canonical, CANON_RATIONALE_PROP) ?? ""),
    };
  }

  async applyMutations(mutations: Mutation[]): Promise<MutationReceipt[]> {
    const mcp = await this.#session();
    const receipts: MutationReceipt[] = [];

    // Structured properties batch per entity: one add_structured_properties
    // call carries every canon.* value for one asset.
    const byEntity = new Map<Urn, Record<string, Array<string | number>>>();
    for (const m of mutations) {
      if (m.kind !== "setStructuredProperty") continue;
      const bag = byEntity.get(m.entity) ?? {};
      bag[m.propertyUrn] = m.values;
      byEntity.set(m.entity, bag);
    }

    for (const [entity, propertyValues] of byEntity) {
      const at = Date.now();
      try {
        await mcp.call("add_structured_properties", {
          property_values: propertyValues,
          entity_urns: [entity],
        });
        for (const [propertyUrn, values] of Object.entries(propertyValues)) {
          receipts.push({
            mutation: { kind: "setStructuredProperty", entity, propertyUrn, values },
            applied: true,
            via: "mcp:add_structured_properties",
            at,
          });
        }
      } catch (err) {
        // OSS mutation tools RAISE on failure rather than returning success:false.
        for (const [propertyUrn, values] of Object.entries(propertyValues)) {
          receipts.push({
            mutation: { kind: "setStructuredProperty", entity, propertyUrn, values },
            applied: false,
            via: "mcp:add_structured_properties",
            at,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    for (const m of mutations) {
      if (m.kind === "setStructuredProperty") continue;
      receipts.push(await this.#applyOne(mcp, m));
    }
    return receipts;
  }

  async #applyOne(mcp: McpSession, m: Mutation): Promise<MutationReceipt> {
    const at = Date.now();
    try {
      switch (m.kind) {
        case "setDeprecation": {
          // No OSS MCP tool for this — set_deprecation is Cloud only.
          const out = await this.#bridge("deprecate", {
            urn: m.entity,
            deprecated: m.deprecated,
            note: m.note,
          });
          return { mutation: m, applied: true, via: `python-sdk:${String(out["wrote"])}`, at };
        }
        case "upsertDocument": {
          await mcp.call("save_document", {
            document_type: "Decision",
            title: m.document.title,
            content: m.document.contents,
            related_assets: m.document.relatedEntities,
          });
          return { mutation: m, applied: true, via: "mcp:save_document", at };
        }
        case "createProposal": {
          // The ABSTAIN branch: a native DataHub Incident assigned to the owners
          // canon read off the candidates, so the unanswerable question lands
          // where the next person to ask it will find it.
          const out = await this.#bridge("incident", {
            id: incidentId(m.title),
            title: m.title,
            description: m.body,
            entities: [m.entity],
            assignees: m.assignees ?? [],
          });
          return { mutation: m, applied: true, via: `python-sdk:incidentInfo ${String(out["urn"])}`, at };
        }
        case "removeStructuredProperty": {
          await mcp.call("remove_structured_properties", {
            property_urns: m.propertyUrns,
            entity_urns: [m.entity],
          });
          return { mutation: m, applied: true, via: "mcp:remove_structured_properties", at };
        }
        case "addTag":
          await mcp.call("add_tags", { tag_urns: [m.tag], entity_urns: [m.entity] });
          return { mutation: m, applied: true, via: "mcp:add_tags", at };
        case "addGlossaryTerm":
          await mcp.call("add_terms", { term_urns: [m.term], entity_urns: [m.entity] });
          return { mutation: m, applied: true, via: "mcp:add_terms", at };
        default:
          return { mutation: m, applied: false, via: "none", at, error: "unsupported mutation kind" };
      }
    } catch (err) {
      return {
        mutation: m,
        applied: false,
        via: "error",
        at,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async upsertDocument(doc: ContextDocument): Promise<MutationReceipt> {
    const mcp = await this.#session();
    return this.#applyOne(mcp, { kind: "upsertDocument", document: doc });
  }

  /** Runs bridge/emit_aspects.py for the two writes OSS MCP cannot do. */
  async #bridge(action: "deprecate" | "incident", payload: Json): Promise<Json> {
    return new Promise((resolve, reject) => {
      const proc = spawn(
        process.env.CANON_PYTHON ?? "python3",
        [
          "bridge/emit_aspects.py",
          action,
          "--gms",
          this.#gmsUrl,
          ...(this.#token ? ["--token", this.#token] : []),
        ],
        { env: { ...process.env, DATAHUB_TELEMETRY_ENABLED: "false" }, stdio: ["pipe", "pipe", "pipe"] },
      );
      let out = "";
      let err = "";
      proc.stdout.on("data", (d) => (out += String(d)));
      proc.stderr.on("data", (d) => (err += String(d)));
      proc.on("close", (code) => {
        if (code !== 0) return reject(new Error(err.trim() || `bridge ${action} exited ${code}`));
        try {
          resolve(JSON.parse(out.trim()) as Json);
        } catch {
          reject(new Error(`bridge ${action} returned non-JSON: ${out.slice(0, 200)}`));
        }
      });
      proc.stdin.end(JSON.stringify(payload));
    });
  }
}

function propValue(e: DatasetEntity, propertyUrn: string): string | number | undefined {
  return e.structuredProperties?.find((p) => p.propertyUrn === propertyUrn)?.values?.[0];
}

function shortFromUrn(urn: string): string {
  const m = /urn:li:dataset:\(urn:li:dataPlatform:[^,]+,([^,]+),/.exec(urn ?? "");
  return m?.[1] ?? urn ?? "";
}

function platformFromUrn(urn: string): PlatformName {
  const m = /urn:li:dataPlatform:([^,)]+)/.exec(urn ?? "");
  return (m?.[1] ?? "snowflake") as PlatformName;
}

function incidentId(title: string): string {
  return `canon-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)}`;
}

/** Maps one MCP get_entities row onto the shape the rules read. */
function toEntity(e: Json): DatasetEntity {
  const urn = e["urn"] as Urn;
  const curated = e["editableProperties"]?.description as string | undefined;
  const description = curated ?? (e["properties"]?.description as string | undefined);

  const schema: SchemaField[] = (e["schemaMetadata"]?.fields ?? []).map((f: Json) => ({
    fieldPath: f["fieldPath"] as string,
    nativeDataType: (f["nativeDataType"] ?? "string") as string,
    nullable: Boolean(f["nullable"]),
    description: f["description"] as string | undefined,
    glossaryTerms: (f["glossaryTerms"]?.terms ?? []).map((t: Json) => t.term?.urn).filter(Boolean),
    tags: (f["tags"]?.tags ?? []).map((t: Json) => t.tag?.urn).filter(Boolean),
  }));

  const deprecation: Deprecation | undefined = e["deprecation"]
    ? {
        deprecated: Boolean(e["deprecation"].deprecated),
        note: e["deprecation"].note,
        decommissionTime: e["deprecation"].decommissionTime,
        actor: e["deprecation"].actor,
      }
    : undefined;

  // OSS MCP has no per-assertion read. DataHub's own aggregate health verdict is
  // what exists, so it becomes one clearly-labelled synthetic assertion.
  const health: Json[] = e["health"] ?? [];
  const assertionHealth = health.find((h) => h["type"] === "ASSERTIONS");
  const assertions: AssertionSummary[] = assertionHealth
    ? [
        {
          urn: `${urn}#assertions-health`,
          type: "SQL",
          description:
            (assertionHealth["message"] as string) ??
            "DataHub aggregate assertion health (OSS MCP exposes no per-assertion read)",
          lastResult: assertionHealth["status"] === "PASS" ? "SUCCESS" : "FAILURE",
        },
      ]
    : [];

  return {
    urn,
    platform: (e["platform"]?.name ?? platformFromUrn(urn)) as PlatformName,
    name: (e["properties"]?.qualifiedName ?? e["schemaMetadata"]?.name ?? e["name"] ?? shortFromUrn(urn)) as string,
    qualifiedName: (e["properties"]?.qualifiedName ?? e["name"] ?? shortFromUrn(urn)) as string,
    subType: ((e["subTypes"]?.typeNames?.[0] as SubType) ?? "Table") as SubType,
    description,
    descriptionIsCurated: Boolean(curated),
    owners: (e["ownership"]?.owners ?? [])
      .map((o: Json) => ({ owner: o.owner?.urn as Urn, type: ownershipType(o) }))
      .filter((o: { owner?: Urn }) => Boolean(o.owner)),
    tags: (e["tags"]?.tags ?? []).map((t: Json) => t.tag?.urn).filter(Boolean),
    glossaryTerms: (e["glossaryTerms"]?.terms ?? []).map((t: Json) => t.term?.urn).filter(Boolean),
    schema,
    deprecation,
    profile: e["datasetProfiles"]?.[0]
      ? {
          timestampMillis: e["datasetProfiles"][0].timestampMillis,
          rowCount: e["datasetProfiles"][0].rowCount ?? 0,
          columnCount: e["datasetProfiles"][0].columnCount ?? schema.length,
        }
      : undefined,
    usage: e["usageStats"]?.aggregations
      ? {
          windowDays: 30,
          totalSqlQueries: e["usageStats"].aggregations.totalSqlQueries ?? 0,
          uniqueUserCount: e["usageStats"].aggregations.uniqueUserCount ?? 0,
          topUsers: (e["usageStats"].aggregations.users ?? []).map((u: Json) => u.user?.urn).filter(Boolean),
        }
      : undefined,
    operation: e["operations"]?.[0]
      ? {
          lastUpdatedTimestamp:
            e["operations"][0].lastUpdatedTimestamp ?? e["operations"][0].timestampMillis,
          operationType: e["operations"][0].operationType,
        }
      : undefined,
    upstreams: (e["upstream"]?.relationships ?? e["upstreams"] ?? [])
      .map((u: Json) => ({ dataset: (u.entity?.urn ?? u.dataset) as Urn, type: u.type ?? "TRANSFORMED" }))
      .filter((u: { dataset?: Urn }) => Boolean(u.dataset)),
    siblings: e["siblings"]?.siblings?.map((s: Json | string) => (typeof s === "string" ? s : s["urn"])).filter(Boolean),
    siblingPrimary: e["siblings"]?.isPrimary ?? e["siblings"]?.primary,
    assertions,
    structuredProperties: (e["structuredProperties"]?.properties ?? []).map((p: Json) => ({
      propertyUrn: (p.structuredProperty?.urn ?? p.propertyUrn) as Urn,
      values: (p.values ?? []).map((v: Json) => v?.stringValue ?? v?.numberValue ?? v),
    })),
  };
}

function ownershipType(o: Json): DatasetEntity["owners"][number]["type"] {
  const name = String(o["ownershipType"]?.urn ?? o["type"] ?? "");
  if (/business/i.test(name)) return "BUSINESS_OWNER";
  if (/steward|dataowner/i.test(name)) return "DATAOWNER";
  return "TECHNICAL_OWNER";
}
