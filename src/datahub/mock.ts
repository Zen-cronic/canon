// Mock DataHub client — reads fixtures/catalog.json.
//
// MOCKED. This returns fixture data in DataHub's aspect shapes; it is NOT a
// recording of a live DataHub instance and must never be presented as measured
// output from one. Mutations are applied to an in-memory overlay so the
// "ask again, the graph answers" loop is genuinely exercised end to end.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DataHubClient, PersistedRuling } from "./client.ts";
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

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE = join(HERE, "..", "..", "fixtures", "catalog.json");

export const CANON_STATUS_PROP = "urn:li:structuredProperty:canon.status";
export const CANON_SUBJECT_PROP = "urn:li:structuredProperty:canon.subject";
export const CANON_SUPERSEDED_BY_PROP = "urn:li:structuredProperty:canon.supersededBy";
export const CANON_DECIDED_AT_PROP = "urn:li:structuredProperty:canon.decidedAt";
export const CANON_RATIONALE_PROP = "urn:li:structuredProperty:canon.rationale";

type CatalogFile = {
  generatedAt: number;
  note: string;
  platforms: string[];
  entityCount: number;
  entities: DatasetEntity[];
  queries: RecordedQuery[];
};

/** Tokenises the way a search engine roughly does, so `orders` also hits `purchase_orders`. */
function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export class MockDataHubClient implements DataHubClient {
  readonly mode = "mock" as const;

  private readonly catalog: CatalogFile;
  private readonly byUrn: Map<Urn, DatasetEntity>;
  private readonly documents: ContextDocument[] = [];
  readonly receipts: MutationReceipt[] = [];

  private constructor(catalog: CatalogFile) {
    this.catalog = catalog;
    this.byUrn = new Map(catalog.entities.map((e) => [e.urn, structuredClone(e)]));
  }

  static load(fixturePath?: string): MockDataHubClient {
    const path = fixturePath ?? process.env.CANON_FIXTURE ?? DEFAULT_FIXTURE;
    const raw = readFileSync(path, "utf8");
    return new MockDataHubClient(JSON.parse(raw) as CatalogFile);
  }

  /** The catalog's own frozen clock. Every freshness claim is relative to this. */
  now(): number {
    return this.catalog.generatedAt;
  }

  stats(): { entities: number; platforms: number; queries: number } {
    return {
      entities: this.byUrn.size,
      platforms: this.catalog.platforms.length,
      queries: this.catalog.queries.length,
    };
  }

  async search(query: string, opts: { limit?: number } = {}): Promise<SearchResult> {
    const limit = opts.limit ?? 20;
    const qt = tokens(query);
    const scored: Array<{ e: DatasetEntity; score: number }> = [];

    for (const e of this.byUrn.values()) {
      const nameTokens = tokens(e.name);
      const descTokens = e.description ? tokens(e.description) : [];
      let score = 0;
      for (const t of qt) {
        if (nameTokens.includes(t)) score += 10;
        else if (nameTokens.some((n) => n.includes(t) || t.includes(n))) score += 4;
        if (descTokens.includes(t)) score += 2;
      }
      // DataHub's ranking leans on popularity; reproduce that bias so canon has to
      // work against the same wrong-but-plausible ordering a human would see.
      if (score > 0 && e.usage) score += Math.min(6, Math.log10(e.usage.totalSqlQueries + 1) * 1.5);
      if (score > 0) scored.push({ e, score });
    }

    scored.sort((a, b) => b.score - a.score || a.e.urn.localeCompare(b.e.urn));
    return {
      query,
      total: scored.length,
      hits: scored.slice(0, limit).map(({ e, score }) => ({
        urn: e.urn,
        name: e.name,
        platform: e.platform,
        subType: e.subType,
        score: Math.round(score * 100) / 100,
      })),
    };
  }

  async getEntities(urns: Urn[]): Promise<DatasetEntity[]> {
    const out: DatasetEntity[] = [];
    for (const u of urns) {
      const e = this.byUrn.get(u);
      if (e) out.push(structuredClone(e));
    }
    return out;
  }

  async getLineage(
    urn: Urn,
    direction: "UPSTREAM" | "DOWNSTREAM",
    degree = 3,
  ): Promise<LineageResult> {
    const nodes: Array<{ urn: Urn; hop: number }> = [];
    const seen = new Set<Urn>([urn]);
    let frontier: Urn[] = [urn];

    for (let hop = 1; hop <= degree; hop++) {
      const next: Urn[] = [];
      for (const cur of frontier) {
        const neighbours =
          direction === "UPSTREAM"
            ? (this.byUrn.get(cur)?.upstreams ?? []).map((u) => u.dataset)
            : [...this.byUrn.values()]
                .filter((e) => e.upstreams.some((u) => u.dataset === cur))
                .map((e) => e.urn);
        for (const n of neighbours) {
          if (seen.has(n)) continue;
          seen.add(n);
          nodes.push({ urn: n, hop });
          next.push(n);
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }

    return { urn, direction, degree, nodes };
  }

  async getDatasetQueries(urn: Urn, opts: { limit?: number } = {}): Promise<RecordedQuery[]> {
    return this.catalog.queries
      .filter((q) => q.touches.includes(urn))
      .sort((a, b) => b.runCount - a.runCount)
      .slice(0, opts.limit ?? 10);
  }

  async getCanonRuling(subject: string): Promise<PersistedRuling | null> {
    const key = subject.trim().toLowerCase();
    for (const e of this.byUrn.values()) {
      const props = e.structuredProperties ?? [];
      const status = props.find((p) => p.propertyUrn === CANON_STATUS_PROP);
      const subj = props.find((p) => p.propertyUrn === CANON_SUBJECT_PROP);
      if (!status || String(status.values[0]) !== "canonical") continue;
      if (!subj || String(subj.values[0]).toLowerCase() !== key) continue;

      const superseded = [...this.byUrn.values()]
        .filter((o) =>
          (o.structuredProperties ?? []).some(
            (p) => p.propertyUrn === CANON_SUPERSEDED_BY_PROP && String(p.values[0]) === e.urn,
          ),
        )
        .map((o) => o.urn);
      const decidedAt = props.find((p) => p.propertyUrn === CANON_DECIDED_AT_PROP);
      const rationale = props.find((p) => p.propertyUrn === CANON_RATIONALE_PROP);
      const doc = this.documents.find((d) => d.relatedEntities.includes(e.urn));

      return {
        subject,
        canonicalUrn: e.urn,
        supersededUrns: superseded,
        decidedAt: decidedAt ? Number(decidedAt.values[0]) : this.now(),
        decidedBy: "canon",
        documentUrn: doc?.urn,
        rationale: rationale ? String(rationale.values[0]) : "",
      };
    }
    return null;
  }

  async applyMutations(mutations: Mutation[]): Promise<MutationReceipt[]> {
    const out: MutationReceipt[] = [];
    for (const m of mutations) {
      out.push(this.apply(m));
    }
    this.receipts.push(...out);
    return out;
  }

  async upsertDocument(doc: ContextDocument): Promise<MutationReceipt> {
    const receipt = this.apply({ kind: "upsertDocument", document: doc });
    this.receipts.push(receipt);
    return receipt;
  }

  private apply(m: Mutation): MutationReceipt {
    const at = this.now();
    const base = { mutation: m, at };

    if (m.kind === "upsertDocument") {
      const urn = `urn:li:document:canon-${this.documents.length + 1}`;
      this.documents.push({ ...m.document, urn });
      return { ...base, applied: true, via: "mcp:upsert_document" };
    }
    if (m.kind === "createProposal") {
      return { ...base, applied: true, via: "mcp:create_proposal" };
    }

    const entity = this.byUrn.get(m.entity);
    if (!entity) {
      return { ...base, applied: false, via: "n/a", error: `unknown entity ${m.entity}` };
    }

    switch (m.kind) {
      case "setStructuredProperty": {
        const props = (entity.structuredProperties ??= []);
        const existing = props.find((p) => p.propertyUrn === m.propertyUrn);
        if (existing) existing.values = m.values;
        else props.push({ propertyUrn: m.propertyUrn, values: m.values });
        return { ...base, applied: true, via: "mcp:set_structured_property" };
      }
      case "setDeprecation": {
        entity.deprecation = { deprecated: m.deprecated, note: m.note, actor: "urn:li:corpuser:canon" };
        return { ...base, applied: true, via: "mcp:update_deprecation" };
      }
      case "addGlossaryTerm": {
        if (!entity.glossaryTerms.includes(m.term)) entity.glossaryTerms.push(m.term);
        return { ...base, applied: true, via: "mcp:add_glossary_terms" };
      }
      case "addTag": {
        if (!entity.tags.includes(m.tag)) entity.tags.push(m.tag);
        return { ...base, applied: true, via: "mcp:add_tags" };
      }
    }
  }

  /** Test/demo helper: the documents this run wrote back. */
  writtenDocuments(): ContextDocument[] {
    return structuredClone(this.documents);
  }
}
