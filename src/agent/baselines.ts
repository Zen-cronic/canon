// The heuristics canon has to beat.
//
// These are not straw men. They are what a text-to-SQL agent, a search box, and
// a "just use the freshest table" rule actually do today — and each of them is
// wrong on the hero case in a different way. Running them alongside canon is the
// product's central claim, so they ship in the product, not only in the eval.

import type { DataHubClient } from "../datahub/client.ts";
import type { Urn } from "../datahub/types.ts";
import type { CandidateEvidence } from "./types.ts";

export type BaselineName = "top-search-hit" | "freshest" | "most-queried-by-humans";

export type BaselinePick = {
  baseline: BaselineName;
  /** One line a judge can read: what this strategy is, in practice. */
  describes: string;
  pick: Urn | null;
  because: string;
};

/** Service/pipeline accounts. Their query volume says nothing about human trust. */
const SERVICE_ACTOR = /^urn:li:corpuser:(svc\.|bi\.|.*\.service$)/;

export function isServiceActor(urn: Urn): boolean {
  return SERVICE_ACTOR.test(urn);
}

export async function runBaselines(
  client: DataHubClient,
  query: string,
  evidence: CandidateEvidence[],
): Promise<BaselinePick[]> {
  const search = await client.search(query, { limit: 20 });
  const topHit = search.hits[0]?.urn ?? null;

  const freshest = [...evidence]
    .filter((c) => c.entity.operation)
    .sort(
      (a, b) =>
        (b.entity.operation?.lastUpdatedTimestamp ?? 0) - (a.entity.operation?.lastUpdatedTimestamp ?? 0),
    )[0];

  const mostHuman = [...evidence].sort((a, b) => b.humanQueryCount - a.humanQueryCount)[0];

  return [
    {
      baseline: "top-search-hit",
      describes: "What a name-matching agent does: take the first thing the catalog search returns.",
      pick: topHit,
      because: topHit
        ? `highest relevance score (${search.hits[0]?.score}) for "${query}" across ${search.total} matches`
        : "no search hits",
    },
    {
      baseline: "freshest",
      describes: "The common heuristic: whichever table was written to most recently must be the live one.",
      pick: freshest?.entity.urn ?? null,
      because: freshest
        ? `last updated ${describeAge(freshest.stalenessDays)} — the most recent write in the candidate set`
        : "no freshness signal available",
    },
    {
      baseline: "most-queried-by-humans",
      describes: "The social-proof heuristic: whatever your colleagues actually query must be right.",
      pick: mostHuman?.entity.urn ?? null,
      because: mostHuman
        ? `${mostHuman.humanQueryCount} queries from ${mostHuman.entity.usage?.uniqueUserCount ?? 0} distinct humans in the last 30 days`
        : "no usage signal available",
    },
  ];
}

function describeAge(days: number | null): string {
  if (days === null) return "unknown";
  if (days < 1) return "in the last few hours";
  return `${Math.floor(days)} days ago`;
}
