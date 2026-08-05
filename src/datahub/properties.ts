// The canon.* structured properties, in one place.
//
// These names are a contract across four things that must agree exactly or the
// write-back silently half-lands: the planner that decides what to write, the
// mock that applies it in memory, the live client that reads it back over MCP,
// and bridge/ingest_catalog.py which defines the properties in DataHub before
// anything can set a value on one.
//
// They did not agree once — the planner wrote `canon.supersededBy` while the
// live reader looked for `canon.superseded_by`, so the ruling read back with
// zero superseded assets and the verification step could not tell the difference
// between "nothing was superseded" and "I cannot see what I wrote". Hence this
// file, and hence the test that asserts the Python definitions match it.
//
// Naming: snake_case, dotted namespace. That is DataHub's own convention for
// structured property qualified names (io.acryl.privacy.retentionTime).

export const CANON_STATUS_PROP = "urn:li:structuredProperty:canon.status";
export const CANON_SUBJECT_PROP = "urn:li:structuredProperty:canon.subject";
export const CANON_DECIDED_AT_PROP = "urn:li:structuredProperty:canon.decided_at";
export const CANON_RATIONALE_PROP = "urn:li:structuredProperty:canon.rationale";
export const CANON_SUPERSEDED_BY_PROP = "urn:li:structuredProperty:canon.superseded_by";

/** Every property canon writes. bridge/ingest_catalog.py must define all of these. */
export const CANON_PROPERTIES = [
  CANON_STATUS_PROP,
  CANON_SUBJECT_PROP,
  CANON_DECIDED_AT_PROP,
  CANON_RATIONALE_PROP,
  CANON_SUPERSEDED_BY_PROP,
] as const;

/**
 * The value written to canon.status on a winner.
 *
 * Question-scoped by design: the claim is "canonical FOR canon.subject", never
 * "canonical" in the abstract. One asset can be canonical for orders and
 * irrelevant to revenue, and marking it must not say otherwise.
 */
export const CANONICAL = "canonical";
